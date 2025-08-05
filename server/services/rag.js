const { OpenAIEmbeddings } = require('@langchain/openai');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

class RAGService {
  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002'
    });
    
    this.vectorStore = null;
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: parseInt(process.env.CHUNK_SIZE) || 1000,
      chunkOverlap: parseInt(process.env.CHUNK_OVERLAP) || 200
    });
    
    this.topK = parseInt(process.env.TOP_K_RESULTS) || 2;
    this.similarityThreshold = 0.4;
    this.isInitialized = false;
    
    // File tracking
    this.fileIndexPath = path.join(process.env.VECTOR_STORE_PATH, 'file_index.json');
    this.fileIndex = new Map();
  }

  async initialize() {
    try {
      const vectorStorePath = process.env.VECTOR_STORE_PATH;
      await fs.mkdir(vectorStorePath, { recursive: true });
      
      // Load existing file index first
      await this.loadFileIndex();
      
      // Check what vector store files exist
      const vectorStoreStatus = await this.checkVectorStoreFiles(vectorStorePath);
      logger.info(`Vector store status: ${JSON.stringify(vectorStoreStatus)}`);
      
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

  async loadFileIndex() {
    try {
      const indexData = await fs.readFile(this.fileIndexPath, 'utf-8');
      const indexArray = JSON.parse(indexData);
      
      this.fileIndex = new Map(indexArray);
      logger.info(`Loaded file index with ${this.fileIndex.size} tracked files`);
      
    } catch (error) {
      this.fileIndex = new Map();
      logger.info('Starting with empty file index');
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

  async createNewVectorStore() {
    try {
      // Clear any existing corrupted files
      await this.clearVectorStoreFiles();
      
      // Create new vector store with minimal content
      this.vectorStore = await FaissStore.fromTexts(
        ['RAG system initialized'],
        [{ source: 'system', type: 'init', indexed_at: new Date().toISOString() }],
        this.embeddings
      );
      
      await this.vectorStore.save(process.env.VECTOR_STORE_PATH);
      
      // Clear file index since we're starting fresh
      this.fileIndex.clear();
      await this.saveFileIndex();
      
      logger.info('Created new vector store');
      
      // Index all files
      await this.indexAllFiles();
      
    } catch (error) {
      logger.error('Failed to create new vector store:', error);
      throw error;
    }
  }

  async clearVectorStoreFiles() {
    try {
      const vectorStorePath = process.env.VECTOR_STORE_PATH;
      const files = await fs.readdir(vectorStorePath);
      
      // Remove vector store files but keep file_index.json
      const vectorStoreFiles = files.filter(f => 
        f === 'faiss.index' || f === 'index.faiss' || f.endsWith('.pkl') || 
        f === 'docstore.json' || f === 'args.json'
      );
      
      for (const file of vectorStoreFiles) {
        try {
          await fs.unlink(path.join(vectorStorePath, file));
          logger.info(`Removed old vector store file: ${file}`);
        } catch (error) {
          logger.warn(`Failed to remove ${file}:`, error.message);
        }
      }
      
    } catch (error) {
      logger.error('Failed to clear vector store files:', error);
    }
  }

  async syncFilesWithVectorStore() {
    try {
      const kbPath = process.env.KNOWLEDGE_BASE_PATH;
      await fs.mkdir(kbPath, { recursive: true });
      
      const files = await fs.readdir(kbPath);
      const supportedExtensions = ['.txt', '.md', '.json', '.pdf', '.docx'];
      
      let newFiles = 0;
      let updatedFiles = 0;
      let skippedFiles = 0;
      
      for (const file of files) {
        const filePath = path.join(kbPath, file);
        const ext = path.extname(file).toLowerCase();
        
        if (!supportedExtensions.includes(ext)) continue;
        
        try {
          const stats = await fs.stat(filePath);
          const fileHash = await this.calculateFileHash(filePath);
          const lastModified = stats.mtime.toISOString();
          
          const existing = this.fileIndex.get(file);
          
          if (!existing) {
            await this.indexFile(filePath, { hash: fileHash, lastModified });
            newFiles++;
          } else if (existing.hash !== fileHash) {
            logger.info(`File modified: ${file}`);
            await this.indexFile(filePath, { hash: fileHash, lastModified });
            updatedFiles++;
          } else {
            skippedFiles++;
          }
          
        } catch (error) {
          logger.error(`Failed to process file ${file}:`, error);
        }
      }
      
      if (newFiles > 0 || updatedFiles > 0) {
        await this.vectorStore.save(process.env.VECTOR_STORE_PATH);
        await this.saveFileIndex();
        logger.info(`File sync complete: ${newFiles} new, ${updatedFiles} updated, ${skippedFiles} unchanged`);
      } else {
        logger.info(`All ${skippedFiles} files are up to date, no indexing needed`);
      }
      
    } catch (error) {
      logger.error('Failed to sync files with vector store:', error);
    }
  }

  async indexAllFiles() {
    try {
      const kbPath = process.env.KNOWLEDGE_BASE_PATH;
      await fs.mkdir(kbPath, { recursive: true });
      
      const files = await fs.readdir(kbPath);
      const supportedExtensions = ['.txt', '.md', '.json', '.pdf', '.docx'];
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
        await this.vectorStore.save(process.env.VECTOR_STORE_PATH);
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
    try {
      const filename = path.basename(filePath);
      const stats = await fs.stat(filePath);
      
      // Special handling for memories.json
      if (filename.toLowerCase() === 'memories.json') {
        return await this.indexMemoriesFile(filePath, fileInfo, stats);
      }
      
      // Regular file indexing for all other files
      const content = await this.extractContent(filePath);
      
      if (!content || !content.trim()) {
        logger.warn(`No content extracted from: ${filename}`);
        return;
      }

      const metadata = {
        source: filePath,
        filename: filename,
        type: path.extname(filePath).substring(1),
        indexed_at: new Date().toISOString(),
        file_size: stats.size,
        last_modified: fileInfo.lastModified || stats.mtime.toISOString()
      };

      const chunks = await this.textSplitter.splitText(content);
      
      if (chunks.length === 0) {
        logger.warn(`No chunks created for: ${filename}`);
        return;
      }

      const metadatas = chunks.map((_, index) => ({
        ...metadata,
        chunk_index: index,
        total_chunks: chunks.length
      }));

      await this.vectorStore.addDocuments(
        chunks.map((chunk, index) => ({
          pageContent: chunk,
          metadata: metadatas[index]
        }))
      );

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
      const jsonContent = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(jsonContent);
      
      if (!data.memories || !Array.isArray(data.memories)) {
        logger.warn('Invalid memories.json structure - expected { memories: [...] }');
        return;
      }

      const filename = path.basename(filePath);
      let totalChunks = 0;
      
      // Index each memory as a separate document
      for (let i = 0; i < data.memories.length; i++) {
        const memory = data.memories[i];
        
        // Create content for this memory
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
          const docxResult = await mammoth.extractRawText({ path: filePath });
          return docxResult.value;
        
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
      const jsonContent = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(jsonContent);
      
      if (!data.memories || !Array.isArray(data.memories)) {
        logger.warn('Invalid memories.json structure - expected { memories: [...] }');
        return '';
      }

      const allMemoriesText = [];
      
      data.memories.forEach((memory, index) => {
        const memoryTexts = [];
        
        // Main comprehensive content
        const mainContent = [
          memory.title ? `Title: ${memory.title}` : '',
          memory.date ? `Date: ${memory.date}` : '',
          memory.tags && Array.isArray(memory.tags) && memory.tags.length > 0 ? 
            `Tags: ${memory.tags.join(', ')}` : '',
          '',
          memory.text || ''
        ].filter(line => line !== '').join('\n');
        
        if (mainContent.trim()) {
          memoryTexts.push(mainContent);
        }
        
        // Searchable field-specific content
        if (memory.title) {
          memoryTexts.push(`Memory titled: ${memory.title}`);
        }
        
        // Tag-based searchable content
        if (memory.tags && Array.isArray(memory.tags) && memory.tags.length > 0) {
          memory.tags.forEach(tag => {
            if (tag && tag.trim()) {
              memoryTexts.push(`Memory tagged: ${tag.trim()}`);
            }
          });
          memoryTexts.push(`Categories: ${memory.tags.filter(t => t && t.trim()).join(' ')}`);
        }
        
        // Date-based searchable content
        if (memory.date) {
          const date = new Date(memory.date);
          if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = date.toLocaleString('default', { month: 'long' });
            
            memoryTexts.push(`Memory from ${year}`);
            memoryTexts.push(`Memory from ${month} ${year}`);
            
            const now = new Date();
            const monthsAgo = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 30);
            
            if (monthsAgo < 6) {
              memoryTexts.push('Recent memory');
            } else if (monthsAgo > 24) {
              memoryTexts.push('Historical memory');
            }
          }
        }
        
        if (memoryTexts.length > 0) {
          allMemoriesText.push(memoryTexts.join('\n\n'));
        }
      });
      
      return allMemoriesText.join('\n\n' + '='.repeat(50) + '\n\n');
      
    } catch (error) {
      logger.error('Failed to extract memories content:', error);
      return '';
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

  // File change handlers for the file watcher
  async handleFileChange(filePath) {
    try {
      const filename = path.basename(filePath);
      const supportedExtensions = ['.txt', '.md', '.json', '.pdf', '.docx'];
      const ext = path.extname(filename).toLowerCase();
      
      if (!supportedExtensions.includes(ext)) {
        return;
      }
      
      const stats = await fs.stat(filePath);
      const fileHash = await this.calculateFileHash(filePath);
      const lastModified = stats.mtime.toISOString();
      
      const existing = this.fileIndex.get(filename);
      
      if (!existing || existing.hash !== fileHash) {
        logger.info(`File ${existing ? 'changed' : 'added'}: ${filename}`);
        
        await this.indexFile(filePath, { hash: fileHash, lastModified });
        await this.vectorStore.save(process.env.VECTOR_STORE_PATH);
        await this.saveFileIndex();
      }
      
    } catch (error) {
      logger.error(`Failed to handle file change for ${filePath}:`, error);
    }
  }

  async handleFileRemoval(filePath) {
    try {
      const filename = path.basename(filePath);
      const existing = this.fileIndex.get(filename);
      
      if (existing) {
        this.fileIndex.delete(filename);
        await this.saveFileIndex();
        logger.info(`Removed ${filename} from file index (${existing.chunks} chunks)`);
      }
      
    } catch (error) {
      logger.error(`Failed to handle file removal for ${filePath}:`, error);
    }
  }

  async search(query, minSimilarity = 0.7) {
    try {
      if (!this.isInitialized || !this.vectorStore) {
        logger.warn('RAG service not initialized, returning empty results');
        return [];
      }

      if (!query || query.trim().length === 0) {
        return [];
      }

      // SIMPLIFIED: Direct search without query variations
      const results = await this.vectorStore.similaritySearchWithScore(
        query.trim(),
        this.topK // Should be 2 to match old app speed
      );

      // Filter by similarity threshold and format results
      const filteredResults = results
        .filter(([doc, score]) => {
          const similarity = 1 - score;
          return similarity >= minSimilarity;
        })
        .map(([doc, score]) => ({
          content: doc.pageContent,
          metadata: doc.metadata,
          similarity: 1 - score,
          score: score
        }))
        .sort((a, b) => b.similarity - a.similarity);

      if (filteredResults.length > 0) {
        logger.info(`RAG search for "${query}": ${filteredResults.length} results found`);
      }
      
      return filteredResults;
      
    } catch (error) {
      logger.error('Failed to search vector store:', error);
      return [];
    }
  }

  generateQueryVariations(originalQuery) {
    const variations = [originalQuery.trim()];
    const queryLower = originalQuery.toLowerCase().trim();
    
    // Add memory-specific variations
    if (!queryLower.includes('memory') && !queryLower.includes('remember')) {
      variations.push(`memory about ${originalQuery}`);
    }
    
    // Add temporal variations
    if (queryLower.includes('recent') || queryLower.includes('latest') || queryLower.includes('when')) {
      variations.push(`date ${originalQuery}`);
    }
    
    // Add category variations
    variations.push(`tagged ${originalQuery}`);
    
    return [...new Set(variations.filter(v => v.trim().length > 0))];
  }

  deduplicateSearchResults(results) {
    const seen = new Set();
    const unique = [];
    
    for (const [doc, score] of results) {
      const identifier = `${doc.metadata.source || 'unknown'}_${doc.metadata.chunk_index || 0}`;
      
      if (!seen.has(identifier)) {
        seen.add(identifier);
        unique.push([doc, score]);
      }
    }
    
    return unique;
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

      await this.vectorStore.save(process.env.VECTOR_STORE_PATH);
      
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

// Singleton instance
let ragService = null;

async function initializeRAG() {
  if (!ragService) {
    ragService = new RAGService();
    await ragService.initialize();
  }
  return ragService;
}

async function getRAGContext(query, minSimilarity = 0.7) {
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