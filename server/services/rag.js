const { OpenAIEmbeddings } = require('@langchain/openai');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');
const dataStore = require('../utils/simpleDataStore');
let instance = null;

class RAGService {
  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: config.rag.embeddingModel || 'text-embedding-ada-002'
    });
    
    this.vectorStore = null;
    this.topK = config.rag.topK || 2;
    this.similarityThreshold = 0.2;
    this.isInitialized = false;
    
    // File tracking - use config paths
    this.vectorStorePath = config.paths.vectorStore;
    this.knowledgeBasePath = config.paths.knowledgeBase;
    this.fileIndexPath = path.join(config.paths.vectorStore, 'file_index.json');
    this.fileIndex = new Map();
    
    // Initialize text splitter with settings
    this.updateTextSplitter();
  }

  updateTextSplitter() {
    // Get current settings
    const settings = config.settings?.rag || config.rag;
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: settings.chunkSize || 1000,
      chunkOverlap: settings.chunkOverlap || 200
    });
  }

  async initialize() {
    try {
      const vectorStorePath = this.vectorStorePath;
      await fs.mkdir(vectorStorePath, { recursive: true });
      
      // Load existing file index first
      await this.loadFileIndex();
      
      // Check what vector store files exist
      const vectorStoreStatus = await this.checkVectorStoreFiles(vectorStorePath);
      logger.info(`Vector store status: ${vectorStoreStatus.hasRequiredFiles ? 'valid' : 'needs creation'}`);
      
      if (vectorStoreStatus.hasRequiredFiles) {
        try {
          logger.info('Attempting to load existing vector store...');
          this.vectorStore = await FaissStore.load(vectorStorePath, this.embeddings);
          
          // Verify the vector store actually works
          await this.testVectorStore();
          
          logger.info(`Successfully loaded existing vector store with ${this.fileIndex.size} tracked files`);
          
          // Check for new or modified files
          await this.syncFilesWithVectorStore();
          
        } catch (error) {
          logger.error('Failed to load existing vector store:', error.message);
          logger.info('Creating new vector store...');
          await this.createNewVectorStore();
        }
      } else {
        logger.info('No valid vector store found, creating new one');
        await this.createNewVectorStore();
      }
      
      this.isInitialized = true;
      
    } catch (error) {
      logger.error('Failed to initialize RAG service:', error);
      throw error;
    }
  }

  async loadFileIndex() {
    try {
      const indexData = await fs.readFile(this.fileIndexPath, 'utf-8');
      const indexArray = JSON.parse(indexData);
      
      this.fileIndex = new Map(indexArray);
      logger.info(`Loaded file index with ${this.fileIndex.size} files`);
      
    } catch (error) {
      // File doesn't exist yet, that's okay
      if (error.code !== 'ENOENT') {
        logger.error('Failed to load file index:', error);
      }
      this.fileIndex = new Map();
    }
  }

  async saveFileIndex() {
    try {
      const indexArray = Array.from(this.fileIndex.entries());
      await fs.writeFile(this.fileIndexPath, JSON.stringify(indexArray, null, 2));
    } catch (error) {
      logger.error('Failed to save file index:', error);
    }
  }

  async checkVectorStoreFiles(vectorStorePath) {
    const status = {
      hasRequiredFiles: false,
      foundFiles: [],
      missingFiles: []
    };
    
    try {
      const files = await fs.readdir(vectorStorePath);
      status.foundFiles = files;
      
      // Check for the actual files that FaissStore creates
      const hasFaissIndex = files.includes('faiss.index') || files.includes('index.faiss');
      const hasDocstore = files.includes('docstore.json');
      
      // Need at least faiss index and docstore to load
      status.hasRequiredFiles = hasFaissIndex && hasDocstore;
      
      if (!hasFaissIndex) {
        status.missingFiles.push('faiss.index');
      }
      if (!hasDocstore) {
        status.missingFiles.push('docstore.json');
      }
      
    } catch (error) {
      logger.error('Failed to check vector store files:', error);
    }
    
    return status;
  }

  async testVectorStore() {
    try {
      // Try a simple search to verify the vector store works
      await this.vectorStore.similaritySearch('test', 1);
      logger.info('Vector store test passed');
    } catch (error) {
      logger.error('Vector store test failed:', error);
      throw new Error('Vector store is corrupted or incompatible');
    }
  }

  async createNewVectorStore() {
    try {
      // Create empty vector store with a dummy document
      const dummyText = "This is an initialization document for the vector store.";
      this.vectorStore = await FaissStore.fromTexts(
        [dummyText],
        [{ source: 'initialization', type: 'system' }],
        this.embeddings
      );
      
      // Save the empty store
      await this.vectorStore.save(this.vectorStorePath);
      
      // Clear file index
      this.fileIndex.clear();
      await this.saveFileIndex();
      
      logger.info('Created new vector store');
      
      // Now index all files in knowledge base
      await this.indexAllFiles();
      
    } catch (error) {
      logger.error('Failed to create new vector store:', error);
      throw error;
    }
  }

  async syncFilesWithVectorStore() {
    try {
      const kbPath = this.knowledgeBasePath;
      
      // Ensure knowledge base directory exists
      await fs.mkdir(kbPath, { recursive: true });
      
      const files = await fs.readdir(kbPath);
      const supportedExtensions = ['.txt', '.md', '.json', '.pdf', '.docx', '.csv', '.xlsx'];
      
      let addedCount = 0;
      let updatedCount = 0;
      
      for (const file of files) {
        const filePath = path.join(kbPath, file);
        const ext = path.extname(file).toLowerCase();
        
        if (supportedExtensions.includes(ext)) {
          try {
            const stats = await fs.stat(filePath);
            const fileHash = await this.calculateFileHash(filePath);
            const lastModified = stats.mtime.toISOString();
            
            const existingFile = this.fileIndex.get(file);
            
            if (!existingFile) {
              // New file - add it
              await this.indexFile(filePath, { hash: fileHash, lastModified });
              addedCount++;
            } else if (existingFile.hash !== fileHash || existingFile.lastModified !== lastModified) {
              // File changed - reindex it
              await this.indexFile(filePath, { hash: fileHash, lastModified });
              updatedCount++;
            }
            
          } catch (error) {
            logger.error(`Failed to sync file ${file}:`, error);
          }
        }
      }
      
      if (addedCount > 0 || updatedCount > 0) {
        await this.vectorStore.save(this.vectorStorePath);
        await this.saveFileIndex();
        logger.info(`Sync complete: ${addedCount} added, ${updatedCount} updated`);
      }
      
    } catch (error) {
      logger.error('Failed to sync files with vector store:', error);
    }
  }

  async indexAllFiles() {
    try {
      const kbPath = this.knowledgeBasePath;
      
      // Ensure knowledge base directory exists
      await fs.mkdir(kbPath, { recursive: true });
      
      const files = await fs.readdir(kbPath);
      const supportedExtensions = ['.txt', '.md', '.json', '.pdf', '.docx', '.csv', '.xlsx'];
      let indexedCount = 0;
      
      logger.info(`Found ${files.length} files in knowledge base`);
      
      for (const file of files) {
        const filePath = path.join(kbPath, file);
        const ext = path.extname(file).toLowerCase();
        
        if (supportedExtensions.includes(ext)) {
          try {
            const stats = await fs.stat(filePath);
            const fileHash = await this.calculateFileHash(filePath);
            const lastModified = stats.mtime.toISOString();
            
            await this.indexFile(filePath, { hash: fileHash, lastModified });
            indexedCount++;
            
          } catch (error) {
            logger.error(`Failed to index ${file}:`, error);
          }
        }
      }
      
      if (indexedCount > 0) {
        await this.vectorStore.save(this.vectorStorePath);
        await this.saveFileIndex();
        logger.info(`Indexed ${indexedCount} files`);
      } else {
        logger.info('No supported files found to index');
      }
      
    } catch (error) {
      logger.error('Failed to index all files:', error);
    }
  }

  async calculateFileHash(filePath) {
    try {
      const content = await fs.readFile(filePath);
      return crypto.createHash('md5').update(content).digest('hex');
    } catch (error) {
      logger.error(`Failed to calculate hash for ${filePath}:`, error);
      return null;
    }
  }

  async indexFile(filePath, fileInfo = {}) {
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      logger.error(`File not found: ${filePath}`);
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = await fs.stat(filePath);

    // Special handling for memories.json
    if (filename === 'memories.json') {
      await this.indexMemoriesFile(filePath, fileInfo, stats);
      await this.vectorStore.save(this.vectorStorePath);
      await this.saveFileIndex();
      return;
    }

    try {
      let chunks = [];
      let metadatas = [];

      // Handle CSV files
      if (ext === '.csv') {
        const content = await fs.readFile(filePath, 'utf-8');

        // Parse CSV - try to detect delimiter
        const lines = content.split('\n').slice(0, 5);
        let delimiter = ',';

        // Simple delimiter detection
        const delimiters = [',', ';', '\t', '|'];
        let maxCount = 0;
        for (const delim of delimiters) {
          const count = (lines[0] || '').split(delim).length;
          if (count > maxCount) {
            maxCount = count;
            delimiter = delim;
          }
        }

        const rows = content.split('\n').filter(line => line.trim());
        if (rows.length === 0) {
          logger.warn(`Empty CSV file: ${filename}`);
          return;
        }

        // Parse headers and data
        const headers = rows[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
        const data = rows.slice(1).map(row => {
          const values = row.split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ''));
          const record = {};
          headers.forEach((header, i) => {
            record[header] = values[i] || '';
          });
          return record;
        });

        // Create searchable content chunks
        const chunkSize = 20; // Number of rows per chunk

        for (let i = 0; i < data.length; i += chunkSize) {
          const chunkData = data.slice(i, Math.min(i + chunkSize, data.length));

          // Create a text representation of the chunk
          let chunkContent = `CSV Data from ${filename}\n`;
          chunkContent += `Columns: ${headers.join(', ')}\n\n`;

          chunkData.forEach((row, idx) => {
            chunkContent += `Row ${i + idx + 2}:\n`;
            headers.forEach(header => {
              if (row[header]) {
                chunkContent += `  ${header}: ${row[header]}\n`;
              }
            });
            chunkContent += '\n';
          });

          chunks.push(chunkContent);
        }

        // Also create a summary chunk
        const summaryChunk = `CSV File: ${filename}\n` +
                            `Total Rows: ${data.length}\n` +
                            `Columns: ${headers.join(', ')}\n` +
                            `Sample Data (first 3 rows):\n` +
                            data.slice(0, 3).map((row, idx) => 
                              `Row ${idx + 1}: ${JSON.stringify(row)}`
                            ).join('\n');

        chunks.unshift(summaryChunk);

        // Create metadata for CSV chunks
        metadatas = chunks.map((_, index) => ({
          source: filePath,
          filename: filename,
          type: ext,
          chunk_index: index,
          total_chunks: chunks.length,
          indexed_at: new Date().toISOString(),
          file_size: stats.size,
          last_modified: fileInfo.lastModified || stats.mtime.toISOString(),
          csv_metadata: {
            total_rows: data.length,
            columns: headers,
            delimiter: delimiter
          }
        }));

      // Handle Excel files
      } else if (ext === '.xlsx') {
        const XLSX = require('xlsx');

        // Read the workbook
        const workbook = XLSX.readFile(filePath);
        let totalRows = 0;

        // Process each sheet
        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];

          // Convert to JSON
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
            header: 1, // Use array of arrays
            defval: '', // Default value for empty cells
            blankrows: false // Skip blank rows
          });

          if (jsonData.length === 0) continue;

          // Get headers (first row)
          const headers = jsonData[0].map(h => String(h || '').trim());
          const data = jsonData.slice(1);

          totalRows += data.length;

          // Create chunks for this sheet
          const chunkSize = 20;

          for (let i = 0; i < data.length; i += chunkSize) {
            const chunkData = data.slice(i, Math.min(i + chunkSize, data.length));

            let chunkContent = `Excel Sheet: ${sheetName} from ${filename}\n`;
            chunkContent += `Columns: ${headers.filter(h => h).join(', ')}\n\n`;

            chunkData.forEach((row, idx) => {
              chunkContent += `Row ${i + idx + 2}:\n`;
              headers.forEach((header, colIdx) => {
                if (header && row[colIdx] !== undefined && row[colIdx] !== '') {
                  chunkContent += `  ${header}: ${row[colIdx]}\n`;
                }
              });
              chunkContent += '\n';
            });

            chunks.push(chunkContent);
          }

          // Add sheet summary
          const sheetSummary = `Excel Sheet Summary: ${sheetName} in ${filename}\n` +
                              `Total Rows: ${data.length}\n` +
                              `Columns: ${headers.filter(h => h).join(', ')}\n` +
                              `Sample Data (first 3 rows):\n` +
                              data.slice(0, 3).map((row, idx) => {
                                const rowObj = {};
                                headers.forEach((h, i) => {
                                  if (h && row[i] !== undefined) rowObj[h] = row[i];
                                });
                                return `Row ${idx + 2}: ${JSON.stringify(rowObj)}`;
                              }).join('\n');

          chunks.unshift(sheetSummary);
        }

        // Create metadata for Excel chunks
        metadatas = chunks.map((_, index) => ({
          source: filePath,
          filename: filename,
          type: ext,
          chunk_index: index,
          total_chunks: chunks.length,
          indexed_at: new Date().toISOString(),
          file_size: stats.size,
          last_modified: fileInfo.lastModified || stats.mtime.toISOString(),
          excel_metadata: {
            total_sheets: workbook.SheetNames.length
          }
        }));

      // Handle all other file types (existing logic)
      } else {
        // Extract content based on file type
        let content = '';

        if (ext === '.txt' || ext === '.md') {
          content = await fs.readFile(filePath, 'utf-8');
        } else if (ext === '.json') {
          const jsonContent = await fs.readFile(filePath, 'utf-8');
          try {
            const data = JSON.parse(jsonContent);
            content = JSON.stringify(data, null, 2);
          } catch (e) {
            content = jsonContent;
          }
        } else if (ext === '.pdf') {
          const pdfParse = require('pdf-parse');
          const pdfBuffer = await fs.readFile(filePath);
          const pdfData = await pdfParse(pdfBuffer);
          content = pdfData.text;
        } else if (ext === '.docx') {
          const mammoth = require('mammoth');
          const docxBuffer = await fs.readFile(filePath);
          const result = await mammoth.extractRawText({ buffer: docxBuffer });
          content = result.value;
        } else {
          logger.warn(`Unsupported file type: ${ext}`);
          return;
        }

        // Split content into chunks
        chunks = await this.textSplitter.splitText(content);

        // Create metadata for regular file chunks
        metadatas = chunks.map((_, index) => ({
          source: filePath,
          filename: filename,
          type: ext,
          chunk_index: index,
          total_chunks: chunks.length,
          indexed_at: new Date().toISOString(),
          file_size: stats.size,
          last_modified: fileInfo.lastModified || stats.mtime.toISOString()
        }));
      }

      // Add documents to vector store
      await this.vectorStore.addDocuments(
        chunks.map((chunk, index) => ({
          pageContent: chunk,
          metadata: metadatas[index]
        }))
      );

      // Update file index
      this.fileIndex.set(filename, {
        hash: fileInfo.hash || await this.calculateFileHash(filePath),
        lastModified: fileInfo.lastModified || stats.mtime.toISOString(),
        chunks: chunks.length,
        indexed_at: new Date().toISOString(),
        filePath: filePath
      });

      logger.info(`Indexed ${filename}: ${chunks.length} chunks`);

    } catch (error) {
      logger.error(`Failed to index file ${filePath}:`, error);
      throw error;
    }
  }

  async indexMemoriesFile(filePath, fileInfo, stats) {
    try {
      const filename = path.basename(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      if (!data.memories || !Array.isArray(data.memories)) {
        logger.warn(`Invalid memories.json structure in ${filePath}`);
        return;
      }
      
      let totalChunks = 0;
      
      // Index each memory as a separate document with rich metadata
      for (let i = 0; i < data.memories.length; i++) {
        const memory = data.memories[i];
        
        // Create structured content for better search
        const memoryContent = [
          memory.title ? `Title: ${memory.title}` : '',
          memory.date ? `Date: ${memory.date}` : '',
          memory.tags && Array.isArray(memory.tags) && memory.tags.length > 0 ? 
            `Tags: ${memory.tags.join(', ')}` : '',
          '',
          memory.text || ''
        ].filter(line => line !== '').join('\n');
        
        const memoryMetadata = {
          source: filePath,
          filename: filename,
          type: 'memory',
          memory_id: memory.id || `memory_${i}`,
          memory_title: memory.title || '',
          memory_date: memory.date || '',
          memory_tags: memory.tags || [],
          memory_index: i,
          indexed_at: new Date().toISOString(),
          file_size: stats.size,
          last_modified: fileInfo.lastModified || stats.mtime.toISOString(),
          chunk_index: 0,
          total_chunks: 1
        };
        
        await this.vectorStore.addDocuments([{
          pageContent: memoryContent,
          metadata: memoryMetadata
        }]);
        
        totalChunks++;
      }

      this.fileIndex.set(filename, {
        hash: fileInfo.hash || await this.calculateFileHash(filePath),
        lastModified: fileInfo.lastModified || stats.mtime.toISOString(),
        chunks: totalChunks,
        indexed_at: new Date().toISOString(),
        filePath: filePath,
        memory_count: data.memories.length
      });

      logger.info(`Indexed ${filename}: ${data.memories.length} memories as ${totalChunks} searchable documents`);
      
    } catch (error) {
      logger.error(`Failed to index memories file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Index URL content - URLs are not files, so they need separate handling
   */
  async indexURL(url, urlId = null) {
    try {
      const { getInternetSearchService } = require('./internetSearch');
      const searchService = getInternetSearchService();
      
      // Fetch and extract content from web
      logger.info(`Fetching content from URL: ${url}`);
      const extracted = await searchService.fetchAndExtract(url);
      
      // Split content into chunks using the existing text splitter
      const chunks = await this.textSplitter.splitText(extracted.content);
      
      // Create metadata for each chunk
      const metadatas = chunks.map((_, index) => ({
        source: url,
        type: 'url',
        url: url,
        title: extracted.title,
        chunk_index: index,
        total_chunks: chunks.length,
        indexed_at: new Date().toISOString(),
        fetched_at: extracted.fetchedAt,
        content_type: extracted.contentType,
        ...extracted.metadata
      }));
      
      // Add to vector store
      await this.vectorStore.addDocuments(
        chunks.map((chunk, index) => ({
          pageContent: chunk,
          metadata: metadatas[index]
        }))
      );
      
      // Use URL as key in file index (or urlId if provided)
      const key = urlId || `url_${Buffer.from(url).toString('base64').substring(0, 20)}`;
      
      // Store URL info in the file index (even though it's not a file)
      this.fileIndex.set(key, {
        url: url,
        title: extracted.title,
        chunks: chunks.length,
        indexed_at: new Date().toISOString(),
        fetched_at: extracted.fetchedAt,
        content_type: extracted.contentType,
        type: 'url',
        metadata: extracted.metadata
      });
      
      // Save after adding URL
      await this.saveFileIndex();
      await this.vectorStore.save(this.vectorStorePath);
      
      logger.info(`Indexed URL ${url}: ${chunks.length} chunks`);
      
      return {
        success: true,
        url: url,
        title: extracted.title,
        chunks: chunks.length,
        key: key
      };
      
    } catch (error) {
      logger.error(`Failed to index URL ${url}:`, error);
      throw error;
    }
  }

  /**
   * Remove URL from index
   */
  async removeURL(urlKey) {
    try {
      const urlInfo = this.fileIndex.get(urlKey);
      if (!urlInfo || urlInfo.type !== 'url') {
        throw new Error('URL not found in index');
      }
      
      // Remove from file index
      this.fileIndex.delete(urlKey);
      await this.saveFileIndex();
      
      logger.info(`Removed URL from index: ${urlInfo.url}`);
      
      // Note: Vectors remain in FAISS store, would need rebuild to fully remove
      // You might want to call rebuildVectorStore() if you want complete removal
      
      return { success: true };
      
    } catch (error) {
      logger.error(`Failed to remove URL ${urlKey}:`, error);
      throw error;
    }
  }

  /**
   * Get all indexed URLs from the file index
   */
  getIndexedURLs() {
    const urls = [];
    
    for (const [key, info] of this.fileIndex.entries()) {
      if (info.type === 'url') {
        urls.push({
          key: key,
          url: info.url,
          title: info.title,
          indexed_at: info.indexed_at,
          chunks: info.chunks,
          metadata: info.metadata
        });
      }
    }
    
    return urls;
  }

  async extractContent(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath).toLowerCase();

    try {
      switch (ext) {
        case '.txt':
        case '.md':
          return await fs.readFile(filePath, 'utf-8');
        
        case '.json':
          // Special handling for memories.json structure
          if (filename === 'memories.json') {
            return await this.extractMemoriesContent(filePath);
          } else {
            // Generic JSON handling for other JSON files
            const jsonContent = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(jsonContent);
            return this.jsonToText(data);
          }
        
        case '.pdf':
          const pdfParse = require('pdf-parse');
          const pdfBuffer = await fs.readFile(filePath);
          const pdfData = await pdfParse(pdfBuffer);
          return pdfData.text;
        
        case '.docx':
          const mammoth = require('mammoth');
          const docxBuffer = await fs.readFile(filePath);
          const result = await mammoth.extractRawText({ buffer: docxBuffer });
          return result.value;
        
        default:
          logger.warn(`Unsupported file type: ${ext}`);
          return null;
      }
    } catch (error) {
      logger.error(`Failed to extract content from ${filePath}:`, error);
      return null;
    }
  }

  async extractMemoriesContent(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      if (!data.memories || !Array.isArray(data.memories)) {
        return this.jsonToText(data);
      }
      
      // For memories, create a concatenated string of all memories
      const memoriesText = data.memories.map((memory, index) => {
        const parts = [`Memory ${index + 1}:`];
        if (memory.title) parts.push(`Title: ${memory.title}`);
        if (memory.date) parts.push(`Date: ${memory.date}`);
        if (memory.tags && memory.tags.length > 0) parts.push(`Tags: ${memory.tags.join(', ')}`);
        if (memory.text) parts.push(`Content: ${memory.text}`);
        return parts.join('\n');
      }).join('\n\n---\n\n');
      
      return memoriesText;
    } catch (error) {
      logger.error('Failed to extract memories content:', error);
      return null;
    }
  }

  jsonToText(obj, prefix = '') {
    let text = '';
    
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        text += this.jsonToText(value, fullKey);
      } else if (Array.isArray(value)) {
        text += `${fullKey}: ${value.join(', ')}\n`;
      } else {
        text += `${fullKey}: ${value}\n`;
      }
    }

    return text;
  }

  async updateTextSplitterFromSettings() {
    try {
      const settings = await dataStore.getSettings();
      const ragSettings = settings?.rag || {};
      
      this.textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: ragSettings.chunkSize || config.rag.chunkSize || 1000,
        chunkOverlap: ragSettings.chunkOverlap || config.rag.chunkOverlap || 200
      });
      
      this.topK = ragSettings.topK || config.rag.topK || 5;
    } catch (error) {
      logger.warn('Failed to update text splitter from settings:', error);
    }
  }

  async search(query, minSimilarity) {
    try {
        if (!this.isInitialized || !this.vectorStore) {
            logger.warn('RAG service not initialized');
            return [];
        }

        const threshold = minSimilarity !== undefined ? minSimilarity : this.similarityThreshold;
        await this.updateTextSplitterFromSettings();

        logger.info(`RAG search: query="${query}", topK=${this.topK}, threshold=${threshold}`);

        // Get more results than needed
        const searchResults = await this.vectorStore.similaritySearchWithScore(
            query,this.topK
        );

        // Log ALL scores to see what's happening
        logger.info(`RAG raw results: ${searchResults.length} items`);
        if (searchResults.length > 0) {
            // Log first 5 results with scores
            searchResults.slice(0, 5).forEach(([doc, score], i) => {
                logger.info(`Result ${i + 1}: score=${score.toFixed(4)}, source=${doc.metadata?.filename || 'unknown'}, content preview: "${doc.pageContent.substring(0, 50)}..."`);
            });
            
            // Check if ANY results meet threshold
            const passingResults = searchResults.filter(([_, score]) => score >= threshold);
            logger.info(`Results passing threshold ${threshold}: ${passingResults.length}`);
        }

        // Filter and return
        const filteredResults = searchResults
            .filter(([_, score]) => score >= threshold)
            .slice(0, this.topK)
            .map(([doc, score]) => ({
                content: doc.pageContent,
                metadata: doc.metadata,
                score: score,
                source: doc.metadata?.filename || doc.metadata?.source || 'unknown'
            }));

        logger.info(`RAG search final: ${filteredResults.length} results returned`);
        
        return filteredResults;
    } catch (error) {
        logger.error('RAG search failed:', error);
        return [];
    }
}

  uniqueResults(results) {
    const seen = new Set();
    const unique = [];
    
    for (const result of results) {
      const key = `${result.metadata.source}-${result.metadata.chunk_index}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(result);
      }
    }
    
    return unique;
  }

  async handleFileChange(filePath) {
    try {
      const filename = path.basename(filePath);
      const stats = await fs.stat(filePath);
      const fileHash = await this.calculateFileHash(filePath);
      const lastModified = stats.mtime.toISOString();
      
      logger.info(`Handling file change for: ${filename}`);
      
      // Reindex the file
      await this.indexFile(filePath, { hash: fileHash, lastModified });
      
      // Save vector store
      await this.vectorStore.save(this.vectorStorePath);
      await this.saveFileIndex();
      
      logger.info(`Successfully reindexed: ${filename}`);
    } catch (error) {
      logger.error(`Failed to handle file change for ${filePath}:`, error);
    }
  }

  async handleFileRemoval(filePath) {
    try {
      const filename = path.basename(filePath);
      
      logger.info(`Handling file removal for: ${filename}`);
      
      // Remove from file index
      this.fileIndex.delete(filename);
      await this.saveFileIndex();
      
      logger.info(`Removed from index: ${filename}`);
      
      // Note: We can't easily remove specific documents from FAISS,
      // so a full reindex might be needed for actual removal
    } catch (error) {
      logger.error(`Failed to handle file removal for ${filePath}:`, error);
    }
  }

  async getStats() {
    try {
      const totalFiles = this.fileIndex.size;
      const totalChunks = Array.from(this.fileIndex.values())
        .reduce((sum, file) => sum + (file.chunks || 0), 0);
      
      return {
        initialized: this.isInitialized,
        totalFiles: totalFiles,
        totalChunks: totalChunks,
        chunkSize: this.textSplitter.chunkSize,
        chunkOverlap: this.textSplitter.chunkOverlap,
        files: Array.from(this.fileIndex.entries()).map(([filename, info]) => ({
          filename,
          chunks: info.chunks,
          lastModified: info.lastModified,
          indexed_at: info.indexed_at
        }))
      };
    } catch (error) {
      return { initialized: false, error: error.message };
    }
  }

  // Legacy methods for compatibility
  async addDocument(content, metadata) {
    try {
      if (!this.isInitialized) {
        throw new Error('RAG service not initialized');
      }

      const chunks = await this.textSplitter.splitText(content);
      
      if (chunks.length === 0) {
        logger.warn('No chunks created from document');
        return;
      }

      const metadatas = chunks.map((_, index) => ({
        ...metadata,
        chunk_index: index,
        total_chunks: chunks.length,
        indexed_at: new Date().toISOString()
      }));

      await this.vectorStore.addDocuments(
        chunks.map((chunk, index) => ({
          pageContent: chunk,
          metadata: metadatas[index]
        }))
      );

      await this.vectorStore.save(this.vectorStorePath);
      
      logger.info(`Added document: ${metadata.source || 'unknown'}, ${chunks.length} chunks`);
      
    } catch (error) {
      logger.error('Failed to add document:', error);
      throw error;
    }
  }

  async updateDocument(documentId, newContent) {
    try {
      logger.info(`Updating document: ${documentId}`);
      await this.addDocument(newContent, { 
        source: documentId,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to update document:', error);
      throw error;
    }
  }

  async deleteDocument(documentId) {
    try {
      logger.info(`Document deletion requested: ${documentId}`);
    } catch (error) {
      logger.error('Failed to delete document:', error);
    }
  }
}

// Add method to remove file from vector store
removeFile = async (filename) => {
  try {
    logger.info(`Removing file from index: ${filename}`);
    
    if (!this.fileIndex.has(filename)) {
      logger.info(`File ${filename} not found in index`);
      return;
    }

    // Remove from file index
    this.fileIndex.delete(filename);
    
    // Save the updated index
    await this.saveFileIndex();
    
    logger.info(`Successfully removed ${filename} from index`);
    
    // Note: FAISS doesn't support removing individual documents easily,
    // so we just remove from index. A full rebuild might be needed for complete removal.
  } catch (error) {
    logger.error(`Failed to remove file ${filename}:`, error);
    // Don't throw - just log the error
  }
}

// Add method to rebuild vector store
rebuildVectorStore = async function() {
  try {
    logger.info('Rebuilding vector store...');
    
    // Create new empty store
    const dummyText = "This is an initialization document for the vector store.";
    this.vectorStore = await FaissStore.fromTexts(
      [dummyText],
      [{ source: 'initialization', type: 'system' }],
      this.embeddings
    );

    // Re-index all files in the file index
    for (const [filename, fileInfo] of this.fileIndex.entries()) {
      const filePath = path.join(this.knowledgeBasePath, filename);
      
      try {
        await fs.access(filePath);
        await this.indexFile(filePath, fileInfo);
      } catch (error) {
        logger.error(`File ${filename} not found, removing from index`);
        this.fileIndex.delete(filename);
      }
    }

    await this.vectorStore.save(this.vectorStorePath);
    await this.saveFileIndex();
    
    logger.info('Vector store rebuilt successfully');
  } catch (error) {
    logger.error('Failed to rebuild vector store:', error);
    throw error;
  }
}

// Singleton instance
let ragService = null;

async function initializeRAG() {
  if (!ragService) {
    ragService = new RAGService();
    await ragService.initialize();
  }
  return ragService;
}

async function getRAGContext(query, minSimilarity) {
  if (!ragService) {
    logger.warn('RAG service not initialized');
    return [];
  }
  
  return ragService.search(query, minSimilarity);
}

async function addDocumentToRAG(content, metadata) {
  if (!ragService) {
    await initializeRAG();
  }
  
  return ragService.addDocument(content, metadata);
}

function getRAGServiceInstance() {
  return ragService;
}

module.exports = {
  initializeRAG,
  getRAGContext,
  addDocumentToRAG,
  getRAGServiceInstance,
  RAGService
};
