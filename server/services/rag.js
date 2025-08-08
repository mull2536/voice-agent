const { OpenAIEmbeddings } = require('@langchain/openai');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');
const dataStore = require('../utils/simpleDataStore');

class RAGService {
  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: config.rag.embeddingModel || 'text-embedding-ada-002'
    });
    
    this.vectorStore = null;
    this.topK = config.rag.topK || 2;
    this.similarityThreshold = 0.4;
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
      const supportedExtensions = ['.txt', '.md', '.json', '.pdf', '.docx'];
      
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
        logger.warn(`No content extracted from ${filename}`);
        return;
      }

      // Update text splitter with current settings
      await this.updateTextSplitterFromSettings();

      const chunks = await this.textSplitter.splitText(content);
      
      if (chunks.length === 0) {
        logger.warn(`No chunks created from ${filename}`);
        return;
      }

      const metadatas = chunks.map((_, index) => ({
        source: filePath,
        filename: filename,
        type: path.extname(filePath),
        chunk_index: index,
        total_chunks: chunks.length,
        indexed_at: new Date().toISOString(),
        file_size: stats.size,
        last_modified: fileInfo.lastModified || stats.mtime.toISOString()
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

  async search(query, minSimilarity = 0.7) {
    try {
      if (!this.isInitialized || !this.vectorStore) {
        logger.warn('RAG service not initialized');
        return [];
      }

      // Update settings before search
      await this.updateTextSplitterFromSettings();

      // Get more results than needed to filter by similarity
      const searchResults = await this.vectorStore.similaritySearchWithScore(
        query,
        this.topK * 2  // Get double to allow filtering
      );

      // Filter by similarity threshold and limit to topK
      const filteredResults = searchResults
        .filter(([_, score]) => score >= minSimilarity)
        .slice(0, this.topK)
        .map(([doc, score]) => ({
          content: doc.pageContent,
          metadata: doc.metadata,
          score: score
        }));

      logger.info(`RAG search for "${query.substring(0, 50)}..." returned ${filteredResults.length} results`);
      
      return this.uniqueResults(filteredResults);
      
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