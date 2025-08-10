// server/services/chatHistory.js
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const logger = require('../utils/logger');
const { performance } = require('perf_hooks');
const config = require('../config');
const dataStore = require('../utils/simpleDataStore'); 

class ChatHistoryService {
    constructor() {
        // Use config paths instead of environment variables
        const dataPath = path.join(__dirname, '../../data');
        this.chatHistoryPath = path.join(dataPath, 'chat_history.json');
        this.chatVectorStorePath = path.join(dataPath, 'chat_vector_store');
        
        this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: config.rag.embeddingModel || 'text-embedding-ada-002'
        });

        // Use RAG settings for text splitter
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: config.rag.chunkSize || 1000,
            chunkOverlap: config.rag.chunkOverlap || 200
        });
        
        // Use RAG topK setting
        this.topK = config.rag.topK || 5;
        
        // Keep minSimilarity as instance property (different from RAG)
        this.minSimilarity = 0.5;
        
        this.chatVectorStore = null;
        this.isInitialized = false;
        
        // Ensure directory exists
        this.ensureDirectories();
    }

    async ensureDirectories() {
        try {
            await fs.mkdir(path.dirname(this.chatHistoryPath), { recursive: true });
            await fs.mkdir(this.chatVectorStorePath, { recursive: true });
        } catch (error) {
            logger.error('Failed to create chat history directories:', error);
        }
    }

    async initialize() {
        try {
            // Initialize chat history JSON
            await this.ensureChatHistoryFile();
            
            // Initialize or load chat vector store
            await this.initializeChatVectorStore();
            
            this.isInitialized = true;
            logger.info('Chat history service initialized successfully');
            
        } catch (error) {
            logger.error('Failed to initialize chat history service:', error);
            throw error;
        }
    }

    async updateSettingsFromDataStore() {
        try {
            const settings = await dataStore.getSettings();
            const ragSettings = settings?.rag || {};
            
            this.textSplitter = new RecursiveCharacterTextSplitter({
                chunkSize: ragSettings.chunkSize || config.rag.chunkSize || 1000,
                chunkOverlap: ragSettings.chunkOverlap || config.rag.chunkOverlap || 200
            });
            
            this.topK = ragSettings.topK || config.rag.topK || 5;
        } catch (error) {
            logger.warn('Failed to update chat history settings:', error);
        }
    }

    async ensureChatHistoryFile() {
        try {
            await fs.access(this.chatHistoryPath);
        } catch (error) {
            // File doesn't exist, create it
            const initialData = { conversations: [] };
            await fs.writeFile(this.chatHistoryPath, JSON.stringify(initialData, null, 2));
            logger.info('Created new chat_history.json file');
        }
    }

    async initializeChatVectorStore() {
        try {
            // Check if vector store exists
            const vectorStoreExists = await this.checkVectorStoreExists();
            
            if (vectorStoreExists) {
                logger.info('Loading existing chat vector store...');
                this.chatVectorStore = await FaissStore.load(this.chatVectorStorePath, this.embeddings);
                logger.info('Chat vector store loaded successfully');
            } else {
                logger.info('Building new chat vector store from existing history...');
                await this.rebuildChatVectorStore();
            }
            
        } catch (error) {
            logger.error('Failed to initialize chat vector store:', error);
            // Create empty vector store as fallback
            this.chatVectorStore = await FaissStore.fromTexts(
                [''], // Empty placeholder
                [{ type: 'placeholder' }],
                this.embeddings
            );
        }
    }

    async checkVectorStoreExists() {
        try {
            await fs.access(path.join(this.chatVectorStorePath, 'docstore.json'));
            await fs.access(path.join(this.chatVectorStorePath, 'faiss.index'));
            return true;
        } catch (error) {
            return false;
        }
    }

    async rebuildChatVectorStore() {
        const startTime = performance.now();
        
        try {
            const chatHistory = await this.loadChatHistory();
            const documents = [];
            
            for (const conversation of chatHistory.conversations) {
                for (const exchange of conversation.exchanges) {
                    if (exchange.user && exchange.user.trim()) {
                        // Create document for user message + assistant response context
                        const combinedText = `User: ${exchange.user}\nAssistant: ${exchange.assistant || ''}`;
                        
                        documents.push({
                            pageContent: combinedText,
                            metadata: {
                                type: 'chat_exchange',
                                person: conversation.person,
                                person_notes: conversation.person_notes,
                                timestamp: exchange.timestamp,
                                conversation_id: conversation.id,
                                exchange_user: exchange.user,
                                exchange_assistant: exchange.assistant
                            }
                        });
                    }
                }
            }

            if (documents.length > 0) {
                // Create vector store from documents
                const texts = documents.map(doc => doc.pageContent);
                const metadatas = documents.map(doc => doc.metadata);
                
                this.chatVectorStore = await FaissStore.fromTexts(texts, metadatas, this.embeddings);
                await this.chatVectorStore.save(this.chatVectorStorePath);
                
                logger.info(`Built chat vector store with ${documents.length} exchanges in ${(performance.now() - startTime).toFixed(2)}ms`);
            } else {
                // Create empty vector store
                this.chatVectorStore = await FaissStore.fromTexts(
                    [''], 
                    [{ type: 'placeholder' }], 
                    this.embeddings
                );
                logger.info('Created empty chat vector store');
            }
            
        } catch (error) {
            logger.error('Failed to rebuild chat vector store:', error);
            throw error;
        }
    }

    async loadChatHistory() {
        try {
            const data = await fs.readFile(this.chatHistoryPath, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            logger.error('Failed to load chat history:', error);
            return { conversations: [] };
        }
    }

    async saveChatHistory(data) {
        try {
            await fs.writeFile(this.chatHistoryPath, JSON.stringify(data, null, 2));
        } catch (error) {
            logger.error('Failed to save chat history:', error);
            throw error;
        }
    }

    async saveConversation(personId, personName, personNotes, userMessage, selectedResponse, ragContext = []) {
        const startTime = performance.now();
        
        try {
            // If selectedResponse is null, this is the initial save before responses are generated
            if (!selectedResponse) {
                // Just store temporarily - will be updated when response is selected
                const conversation = {
                    personId,
                    personName,
                    personNotes,
                    userMessage,
                    ragContext: ragContext ? ragContext.map(r => ({
                        content: r.content.substring(0, 200) + '...',
                        source: r.metadata?.filename || r.metadata?.source || 'unknown'
                    })) : [],
                    metadata: {
                        ragUsed: ragContext ? ragContext.length > 0 : false,
                        ragSourcesCount: ragContext ? ragContext.length : 0,
                        ragSources: ragContext ? ragContext.map(r => r.source) : [],
                        chatHistoryUsed: false,
                        chatHistorySourcesCount: 0,
                        timestamp: new Date().toISOString()
                    }
                };
                
                const endTime = performance.now();
                logger.info(`Initial conversation saved in ${(endTime - startTime).toFixed(2)}ms`);
                
                return conversation;
            }
            
            // Handle the case where a response has been selected
            const chatHistory = await this.loadChatHistory();
            const timestamp = new Date().toISOString();
            
            // Find or create conversation for this person
            let conversation = chatHistory.conversations.find(conv => conv.person === personName);
            
            if (!conversation) {
                conversation = {
                    id: `conv_${Date.now()}_${uuidv4().substring(0, 8)}`,
                    person: personName,
                    person_notes: personNotes || '',
                    timestamp: timestamp,
                    exchanges: []
                };
                chatHistory.conversations.push(conversation);
            }

            // Create exchange object - only save the selected response
            const exchange = {
                user: userMessage,
                assistant: selectedResponse,
                timestamp: timestamp,
                vectorized: false
            };

            conversation.exchanges.push(exchange);
            conversation.timestamp = timestamp;

            // Save to file
            await this.saveChatHistory(chatHistory);

            // Add to vector store immediately
            if (selectedResponse) {
                await this.addExchangeToVectorStore(exchange, conversation);
            }

            const endTime = performance.now();
            logger.info(`Chat exchange saved in ${(endTime - startTime).toFixed(2)}ms`);

            return conversation;
            
        } catch (error) {
            logger.error('Failed to save conversation:', error);
            throw error;
        }
    }

    async addExchangeToVectorStore(exchange, conversation) {
        try {
            if (!this.chatVectorStore) {
                logger.warn('Chat vector store not initialized');
                return;
            }
            
            const combinedText = `User: ${exchange.user}\nAssistant: ${exchange.assistant}`;
            
            await this.chatVectorStore.addDocuments([{
                pageContent: combinedText,
                metadata: {
                    type: 'chat_exchange',
                    person: conversation.person,
                    person_notes: conversation.person_notes,
                    timestamp: exchange.timestamp,
                    conversation_id: conversation.id,
                    exchange_user: exchange.user,
                    exchange_assistant: exchange.assistant
                }
            }]);
            
            // Save vector store periodically
            await this.chatVectorStore.save(this.chatVectorStorePath);
            
            exchange.vectorized = true;
            
        } catch (error) {
            logger.error('Failed to add exchange to vector store:', error);
        }
    }

    async searchRelevantHistory(personId, query, topK, minSimilarity) {
        const startTime = performance.now();
        // Update settings from dataStore before search
        await this.updateSettingsFromDataStore();
        
        // Use provided values or instance defaults from RAG settings
        const k = topK !== undefined ? topK : this.topK;
        const threshold = minSimilarity !== undefined ? minSimilarity : this.minSimilarity;
        
        try {
            if (!this.chatVectorStore) {
                logger.warn('Chat vector store not initialized');
                return [];
            }
            
            // Search for similar conversations
            const searchResults = await this.chatVectorStore.similaritySearchWithScore(
                query,
                k * 2 // Get more results to filter
            );
            
            // Filter by similarity threshold
            const relevantResults = searchResults
                .filter(([doc, score]) => {
                    return score >= threshold;
                })
                .slice(0, k)
                .map(([doc, score]) => ({
                    userMessage: doc.metadata.exchange_user,
                    assistantResponse: doc.metadata.exchange_assistant,
                    timestamp: doc.metadata.timestamp,
                    person: doc.metadata.person,
                    score: score
                }));
            
            const endTime = performance.now();
            logger.info(`Chat history search completed in ${(endTime - startTime).toFixed(2)}ms, found ${relevantResults.length} relevant exchanges`);
            
            return relevantResults;
            
        } catch (error) {
            logger.error('Failed to search chat history:', error);
            return [];
        }
    }

    async getPersonContext(personId, limit) {
        const startTime = performance.now();
        
        // Use provided limit or topK from RAG settings
        const maxResults = limit !== undefined ? limit : this.topK;

        try {
            const chatHistory = await this.loadChatHistory();
            
            // Find conversations for this person
            const personConversations = chatHistory.conversations.filter(
                conv => conv.person === personId || conv.person.toLowerCase() === personId.toLowerCase()
            );
            
            if (personConversations.length === 0) {
                return null;
            }
            
            // Get recent exchanges
            const allExchanges = [];
            for (const conv of personConversations) {
                for (const exchange of conv.exchanges) {
                    allExchanges.push({
                        ...exchange,
                        person: conv.person,
                        person_notes: conv.person_notes
                    });
                }
            }
            
            // Sort by timestamp and get most recent
            allExchanges.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            const recentExchanges = allExchanges.slice(0, maxResults);
            
            // Build context string
            const contextParts = [];
            for (const exchange of recentExchanges) {
                contextParts.push(`[${new Date(exchange.timestamp).toLocaleString()}] User: ${exchange.user}`);
                if (exchange.assistant) {
                    contextParts.push(`Assistant: ${exchange.assistant}`);
                }
            }
            
            const endTime = performance.now();
            logger.info(`Retrieved person context in ${(endTime - startTime).toFixed(2)}ms`);
            
            return contextParts.join('\n');
            
        } catch (error) {
            logger.error('Failed to get person context:', error);
            return null;
        }
    }

    async getStats() {
        try {
            const chatHistory = await this.loadChatHistory();
            const totalConversations = chatHistory.conversations.length;
            const totalExchanges = chatHistory.conversations.reduce(
                (sum, conv) => sum + conv.exchanges.length, 0
            );
            
            const peopleStats = {};
            for (const conv of chatHistory.conversations) {
                if (!peopleStats[conv.person]) {
                    peopleStats[conv.person] = {
                        exchanges: 0,
                        lastInteraction: null
                    };
                }
                peopleStats[conv.person].exchanges += conv.exchanges.length;
                peopleStats[conv.person].lastInteraction = conv.timestamp;
            }
            
            return {
                initialized: this.isInitialized,
                totalConversations,
                totalExchanges,
                peopleStats,
                vectorStoreExists: this.chatVectorStore !== null
            };
            
        } catch (error) {
            logger.error('Failed to get chat history stats:', error);
            return { initialized: false, error: error.message };
        }
    }
}

module.exports = ChatHistoryService;