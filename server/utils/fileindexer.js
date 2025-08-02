const chokidar = require('chokidar');
const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { getRAGContext, RAGService } = require('../services/rag');
const logger = require('./logger');

class FileIndexer {
  constructor() {
    this.knowledgeBasePath = process.env.KNOWLEDGE_BASE_PATH;
    this.supportedExtensions = ['.txt', '.pdf', '.docx', '.json'];
    this.watcher = null;
    this.ragService = null;
    this.indexedFiles = new Set();
  }

  async initialize() {
    try {
      // Ensure knowledge base directory exists
      await fs.mkdir(this.knowledgeBasePath, { recursive: true });
      
      // Initialize RAG service
      this.ragService = new RAGService();
      await this.ragService.initialize();
      
      // Index existing files
      await this.indexExistingFiles();
      
      // Start watching for changes
      this.startWatcher();
      
      logger.info('File indexer initialized');
    } catch (error) {
      logger.error('Failed to initialize file indexer:', error);
      throw error;
    }
  }

  async indexExistingFiles() {
    try {
      const files = await fs.readdir(this.knowledgeBasePath);
      
      for (const file of files) {
        const filePath = path.join(this.knowledgeBasePath, file);
        const ext = path.extname(file).toLowerCase();
        
        if (this.supportedExtensions.includes(ext)) {
          await this.indexFile(filePath);
        }
      }
      
      logger.info(`Indexed ${this.indexedFiles.size} existing files`);
    } catch (error) {
      logger.error('Failed to index existing files:', error);
    }
  }

  startWatcher() {
    this.watcher = chokidar.watch(this.knowledgeBasePath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    this.watcher
      .on('add', (filePath) => this.handleFileAdd(filePath))
      .on('change', (filePath) => this.handleFileChange(filePath))
      .on('unlink', (filePath) => this.handleFileRemove(filePath))
      .on('error', (error) => logger.error('Watcher error:', error));

    logger.info('File watcher started');
  }

  async handleFileAdd(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    if (this.supportedExtensions.includes(ext)) {
      logger.info(`New file detected: ${path.basename(filePath)}`);
      await this.indexFile(filePath);
    }
  }

  async handleFileChange(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    if (this.supportedExtensions.includes(ext)) {
      logger.info(`File changed: ${path.basename(filePath)}`);
      await this.indexFile(filePath, true);
    }
  }

  async handleFileRemove(filePath) {
    if (this.indexedFiles.has(filePath)) {
      logger.info(`File removed: ${path.basename(filePath)}`);
      this.indexedFiles.delete(filePath);
      
      // In production, you'd also remove from vector store
      await this.ragService.deleteDocument(filePath);
    }
  }

  async indexFile(filePath, isUpdate = false) {
    try {
      const content = await this.extractContent(filePath);
      
      if (!content) {
        logger.warn(`No content extracted from: ${filePath}`);
        return;
      }

      const metadata = {
        source: filePath,
        filename: path.basename(filePath),
        type: path.extname(filePath).substring(1),
        indexed_at: new Date().toISOString(),
        is_update: isUpdate
      };

      if (isUpdate) {
        await this.ragService.updateDocument(filePath, content);
      } else {
        await this.ragService.addDocument(content, metadata);
      }

      this.indexedFiles.add(filePath);
      logger.info(`Successfully indexed: ${path.basename(filePath)}`);

    } catch (error) {
      logger.error(`Failed to index file ${filePath}:`, error);
    }
  }

  async extractContent(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    try {
      switch (ext) {
        case '.txt':
          return await this.extractTextContent(filePath);
        
        case '.pdf':
          return await this.extractPDFContent(filePath);
        
        case '.docx':
          return await this.extractDocxContent(filePath);
        
        case '.json':
          return await this.extractJSONContent(filePath);
        
        default:
          logger.warn(`Unsupported file type: ${ext}`);
          return null;
      }
    } catch (error) {
      logger.error(`Failed to extract content from ${filePath}:`, error);
      return null;
    }
  }

  async extractTextContent(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    return content.trim();
  }

  async extractPDFContent(filePath) {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text.trim();
  }

  async extractDocxContent(filePath) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  }

  async extractJSONContent(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    // Convert JSON to readable text format
    return this.jsonToText(data);
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

module.exports = {
  startFileWatcher,
  stopFileWatcher
};