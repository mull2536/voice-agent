const { OpenAIEmbeddings } = require('@langchain/openai');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const fs = require('fs').promises;
const path = require('path');
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
    
    this.topK = parseInt(process.env.TOP_K_RESULTS) || 5;
  }

  async initialize() {
    try {
      const vectorStorePath = process.env.VECTOR_STORE_PATH;
      
      // Check if vector store exists
      const indexPath = path.join(vectorStorePath, 'index.faiss');
      const exists = await fs.access(indexPath).then(() => true).catch(() => false);
      
      if (exists) {
        // Load existing vector store
        this.vectorStore = await FaissStore.load(vectorStorePath, this.embeddings);
        logger.info('Loaded existing vector store');
      } else {
        // Create new vector store
        await fs.mkdir(vectorStorePath, { recursive: true });
        this.vectorStore = await FaissStore.fromTexts(
          ['Initial document'],
          [{ source: 'init' }],
          this.embeddings
        );
        await this.vectorStore.save(vectorStorePath);
        logger.info('Created new vector store');
      }
      
    } catch (error) {
      logger.error('Failed to initialize RAG service:', error);
      throw error;
    }
  }

  async addDocument(content, metadata) {
    try {
      // Split document into chunks
      const chunks = await this.textSplitter.splitText(content);
      
      // Create metadata for each chunk
      const metadatas = chunks.map((_, index) => ({
        ...metadata,
        chunk: index,
        totalChunks: chunks.length
      }));
      
      // Add to vector store
      await this.vectorStore.addDocuments(
        chunks.map(chunk => ({ pageContent: chunk, metadata: {} }))
      );
      
      // Save vector store
      await this.vectorStore.save(process.env.VECTOR_STORE_PATH);
      
      logger.info(`Added document: ${metadata.source}, ${chunks.length} chunks`);
      
    } catch (error) {
      logger.error('Failed to add document:', error);
      throw error;
    }
  }

  async search(query) {
    try {
      if (!this.vectorStore) {
        logger.warn('Vector store not initialized');
        return [];
      }
      
      // Perform similarity search
      const results = await this.vectorStore.similaritySearchWithScore(
        query,
        this.topK
      );
      
      // Format results
      return results.map(([doc, score]) => ({
        content: doc.pageContent,
        metadata: doc.metadata,
        score
      }));
      
    } catch (error) {
      logger.error('Failed to search vector store:', error);
      return [];
    }
  }

  async updateDocument(documentId, newContent) {
    try {
      // For now, we'll remove and re-add
      // In production, you'd want more sophisticated update logic
      logger.info(`Updating document: ${documentId}`);
      
      // Re-add with same metadata
      await this.addDocument(newContent, { 
        source: documentId,
        updatedAt: new Date().toISOString()
      });
      
    } catch (error) {
      logger.error('Failed to update document:', error);
      throw error;
    }
  }

  async deleteDocument(documentId) {
    try {
      // This is a simplified version
      // In production, you'd track document IDs in the vector store
      logger.info(`Document deletion requested: ${documentId}`);
      
      // For now, we'll need to rebuild the store without this document
      // This is inefficient but works for MVP
      
    } catch (error) {
      logger.error('Failed to delete document:', error);
      throw error;
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

async function getRAGContext(query) {
  if (!ragService) {
    await initializeRAG();
  }
  
  return ragService.search(query);
}

module.exports = {
  initializeRAG,
  getRAGContext,
  RAGService
};