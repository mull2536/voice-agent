const chokidar = require('chokidar');
const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { getRAGServiceInstance } = require('../services/rag');
const logger = require('./logger');
const config = require('../config');

class FileIndexer {
  constructor() {
    this.knowledgeBasePath = config.paths.knowledgeBase;
    this.supportedExtensions = ['.txt', '.pdf', '.docx', '.json', '.md'];
    this.watcher = null;
    this.ragService = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Ensure knowledge base directory exists
      await fs.mkdir(this.knowledgeBasePath, { recursive: true });
      
      // Get RAG service instance (should already be initialized)
      this.ragService = getRAGServiceInstance();
      
      if (!this.ragService) {
        throw new Error('RAG service not available');
      }
      
      // Start watching for changes (but don't index existing files - RAG service already did that)
      this.startWatcher();
      
      this.isInitialized = true;
      logger.info('File indexer initialized');
      
    } catch (error) {
      logger.error('Failed to initialize file indexer:', error);
      throw error;
    }
  }

  startWatcher() {
    this.watcher = chokidar.watch(this.knowledgeBasePath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait 2 seconds after file stops changing
        pollInterval: 100
      },
      ignoreInitial: true // IMPORTANT: Don't trigger events for existing files
    });

    this.watcher
      .on('add', (filePath) => this.handleFileAdd(filePath))
      .on('change', (filePath) => this.handleFileChange(filePath))
      .on('unlink', (filePath) => this.handleFileRemove(filePath))
      .on('error', (error) => logger.error('File watcher error:', error));

    logger.info('File watcher started (monitoring for changes only)');
  }

  async handleFileAdd(filePath) {
    if (!this.isValidFile(filePath)) {
      return;
    }

    logger.info(`New file detected: ${path.basename(filePath)}`);
    
    // Use RAG service's file change handler
    if (this.ragService && this.ragService.handleFileChange) {
      await this.ragService.handleFileChange(filePath);
    } else {
      // Fallback to manual indexing
      await this.indexNewFile(filePath);
    }
  }

  async handleFileChange(filePath) {
    if (!this.isValidFile(filePath)) {
      return;
    }

    logger.info(`File changed: ${path.basename(filePath)}`);
    
    // Use RAG service's file change handler
    if (this.ragService && this.ragService.handleFileChange) {
      await this.ragService.handleFileChange(filePath);
    } else {
      // Fallback to manual indexing
      await this.indexNewFile(filePath);
    }
  }

  async handleFileRemove(filePath) {
    if (!this.isValidFile(filePath)) {
      return;
    }

    logger.info(`File removed: ${path.basename(filePath)}`);
    
    // Use RAG service's file removal handler
    if (this.ragService && this.ragService.handleFileRemoval) {
      await this.ragService.handleFileRemoval(filePath);
    }
  }

  isValidFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  // Fallback method if RAG service doesn't have file handlers
  async indexNewFile(filePath) {
    try {
      const content = await this.extractContent(filePath);
      
      if (!content) {
        logger.warn(`No content extracted from: ${filePath}`);
        return;
      }

      const metadata = {
        source: filePath,
        filename: path.basename(filePath),
        type: path.extname(filePath),
        indexed_at: new Date().toISOString()
      };

      // Use the RAG service's addDocument method
      if (this.ragService && this.ragService.addDocument) {
        await this.ragService.addDocument(content, metadata);
        logger.info(`Successfully indexed: ${path.basename(filePath)}`);
      }
    } catch (error) {
      logger.error(`Failed to index file ${filePath}:`, error);
    }
  }

  async extractContent(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    try {
      switch (ext) {
        case '.txt':
        case '.md':
          return await fs.readFile(filePath, 'utf-8');
        
        case '.json':
          const jsonContent = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(jsonContent);
          return this.jsonToText(data);
        
        case '.pdf':
          const pdfBuffer = await fs.readFile(filePath);
          const pdfData = await pdfParse(pdfBuffer);
          return pdfData.text;
        
        case '.docx':
          const docxBuffer = await fs.readFile(filePath);
          const result = await mammoth.extractRawText({ buffer: docxBuffer });
          return result.value;
        
        default:
          return null;
      }
    } catch (error) {
      logger.error(`Failed to extract content from ${filePath}:`, error);
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

  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      logger.info('File watcher stopped');
    }
  }

  // Get statistics about file indexing
  async getStats() {
    if (this.ragService && this.ragService.getStats) {
      return await this.ragService.getStats();
    }
    
    return {
      initialized: this.isInitialized,
      error: 'RAG service stats not available'
    };
  }
}

let fileIndexer = null;

async function startFileWatcher() {
  if (!fileIndexer) {
    fileIndexer = new FileIndexer();
    await fileIndexer.initialize();
  }
  return fileIndexer;
}

async function stopFileWatcher() {
  if (fileIndexer) {
    await fileIndexer.stop();
    fileIndexer = null;
  }
}

async function getFileIndexerStats() {
  if (fileIndexer) {
    return await fileIndexer.getStats();
  }
  return { error: 'File indexer not initialized' };
}

module.exports = {
  startFileWatcher,
  stopFileWatcher,
  getFileIndexerStats
};