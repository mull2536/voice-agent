// server/services/chatHistory.js
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const logger = require('../utils/logger');
const { performance } = require('perf_hooks');

class ChatHistoryService {
    constructor() {
        this.chatHistoryPath = path.join(process.env.VECTOR_STORE_PATH, '../chat_history.json');
        this.chatVectorStorePath = path.join(process.env.VECTOR_STORE_PATH, '../chat_vector_store');
        
        this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: 'text-embedding-ada-002'
        });
        
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
                
                logger.info(`Chat vector store rebuilt with ${documents.length} exchanges in ${(performance.now() - startTime).toFixed(2)}ms`);
            } else {
                // Create empty vector store
                this.chatVectorStore = await FaissStore.fromTexts(
                    [''], 
                    [{ type: 'placeholder' }], 
                    this.embeddings
                );
                await this.chatVectorStore.save(this.chatVectorStorePath);
                logger.info('Created empty chat vector store');
            }
            
        } catch (error) {
            logger.error('Failed to rebuild chat vector store:', error);
            throw error;
        }
    }

    async loadChatHistory() {
        try {
            const data = await fs.readFile(this.chatHistoryPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            logger.error('Failed to load chat history:', error);
            return { conversations: [] };
        }
    }

    async saveChatHistory(chatHistory) {
        try {
            await fs.writeFile(this.chatHistoryPath, JSON.stringify(chatHistory, null, 2));
        } catch (error) {
            logger.error('Failed to save chat history:', error);
            throw error;
        }
    }

    async saveConversationExchange(personId, personName, personNotes, userMessage, assistantResponse = null) {
        const startTime = performance.now();
        
        try {
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

            // Create exchange object - only save what appears in conversationUI
            const exchange = {
                user: userMessage,
                assistant: assistantResponse, // Only the selected/spoken response
                timestamp: timestamp,
                vectorized: false // Will be vectorized on next rebuild
            };

            conversation.exchanges.push(exchange);
            conversation.timestamp = timestamp; // Update conversation timestamp

            // Save to file
            await this.saveChatHistory(chatHistory);

            // Add to vector store immediately (incremental) - only if we have assistant response
            if (assistantResponse) {
                await this.addExchangeToVectorStore(exchange, conversation);
            }

            const endTime = performance.now();
            logger.info(`Chat exchange saved in ${(endTime - startTime).toFixed(2)}ms`);

            return conversation.id;
            
        } catch (error) {
            logger.error('Failed to save conversation exchange:', error);
            throw error;
        }
    }

    async addExchangeToVectorStore(exchange, conversation) {
        try {
            if (!this.chatVectorStore || !exchange.assistant) return;

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

            await this.chatVectorStore.save(this.chatVectorStorePath);
            
        } catch (error) {
            logger.error('Failed to add exchange to vector store:', error);
        }
    }

    async updateSelectedResponse(personName, exchangeTimestamp, selectedResponse) {
        const startTime = performance.now();
        
        try {
            const chatHistory = await this.loadChatHistory();
            
            // Find the conversation and exchange
            const conversation = chatHistory.conversations.find(conv => conv.person === personName);
            if (!conversation) return false;

            const exchange = conversation.exchanges.find(ex => ex.timestamp === exchangeTimestamp);
            if (!exchange) return false;

            // Update the assistant response
            exchange.assistant = selectedResponse;

            // Save to file
            await this.saveChatHistory(chatHistory);

            // Add/update in vector store
            await this.addExchangeToVectorStore(exchange, conversation);

            const endTime = performance.now();
            logger.info(`Selected response updated in ${(endTime - startTime).toFixed(2)}ms`);

            return true;
            
        } catch (error) {
            logger.error('Failed to update selected response:', error);
            return false;
        }
    }

    async searchChatHistory(query, personName = null, topK = 2, minSimilarity = 0.3) {
        const startTime = performance.now();
        
        try {
            if (!this.chatVectorStore || !query.trim()) {
                return [];
            }

            // Perform similarity search
            const results = await this.chatVectorStore.similaritySearchWithScore(query, topK * 2); // Get more then filter

            // Filter and format results
            let filteredResults = results
                .filter(([doc, score]) => {
                    const similarity = 1 - score;
                    if (similarity < minSimilarity) return false;
                    
                    // If person specified, filter by person
                    if (personName && doc.metadata.person !== personName) return false;
                    
                    return true;
                })
                .map(([doc, score]) => ({
                    content: doc.pageContent,
                    metadata: doc.metadata,
                    similarity: 1 - score,
                    score: score
                }))
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, topK);

            const endTime = performance.now();
            
            if (filteredResults.length > 0) {
                logger.info(`Chat history search: ${filteredResults.length} results in ${(endTime - startTime).toFixed(2)}ms`);
            }

            return filteredResults;
            
        } catch (error) {
            logger.error('Failed to search chat history:', error);
            return [];
        }
    }

    async getRecentExchanges(personName, limit = 5) {
        try {
            const chatHistory = await this.loadChatHistory();
            const conversation = chatHistory.conversations.find(conv => conv.person === personName);
            
            if (!conversation || !conversation.exchanges) {
                return [];
            }

            return conversation.exchanges
                .slice(-limit)
                .map(exchange => ({
                    user: exchange.user,
                    assistant: exchange.assistant,
                    timestamp: exchange.timestamp
                }));
                
        } catch (error) {
            logger.error('Failed to get recent exchanges:', error);
            return [];
        }
    }
}

module.exports = ChatHistoryService;