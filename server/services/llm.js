// server/services/llm.js
const { OpenAI } = require('openai');
const dataStore = require('../utils/simpleDataStore');
const { getRAGContext } = require('./rag');
const logger = require('../utils/logger');
const ChatHistoryService = require('./chatHistory');
const sessionQueueManager = require('../utils/sessionQueueManager');

class LLMService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.systemPrompt = `You are a helpful AI assistant designed to support natural 
        conversation for someone with ALS who uses eye gaze technology. Be concise but warm. 
        Understand that communication may be slower, so be patient and supportive. Provide 
        thoughtful, contextual responses that continue the conversation naturally.`;

        this.chatHistoryService = new ChatHistoryService();
        this.initializeChatHistory();
    }

    async initializeChatHistory() {
        try {
            await this.chatHistoryService.initialize();
            logger.info('Chat history service initialized in LLM service');
        } catch (error) {
            logger.error('Failed to initialize chat history service:', error);
        }
    }

    async generateResponses(userMessage, personId = 'other', socketId = null) {
        const timings = {}; // Collect all timing data to return
        
        try {
            // 1. GET PERSON CONTEXT
            const personStartTime = Date.now();
            const personContext = await dataStore.getPersonContext(personId);
            const person = personContext?.person || { name: 'Other', notes: '' };
            timings.personLookup = Date.now() - personStartTime;

            // 2. GET RECENT CONVERSATION CONTEXT
            const recentStartTime = Date.now();
            const recentContext = await this.chatHistoryService.getRecentExchanges(person.name, 4);
            timings.recentContext = Date.now() - recentStartTime;
            
            // 3. GET SESSION CONTEXT
            const sessionStartTime = Date.now();
            const sessionContext = socketId ? sessionQueueManager.buildSessionContext(socketId) : '';
            timings.sessionContext = Date.now() - sessionStartTime;
            
            // 4. GET RAG CONTEXT
            const ragStartTime = Date.now();
            const ragContext = await this.getEnhancedRAGContext(userMessage, person);
            timings.ragLookup = Date.now() - ragStartTime;

            // 5. GET CHAT HISTORY CONTEXT
            const chatHistoryStartTime = Date.now();
            const chatHistoryContext = await this.chatHistoryService.searchChatHistory(userMessage, person.name, 2, 0.3);
            timings.chatHistorySearch = Date.now() - chatHistoryStartTime;
            
            // 6. BUILD CONTEXT MESSAGE
            const buildStartTime = Date.now();
            const context = this.buildContextMessage(userMessage, person, recentContext, ragContext, chatHistoryContext, sessionContext, personContext);
            timings.messageBuilding = Date.now() - buildStartTime;
            
            // 7. LLM API CALL
            const llmStartTime = Date.now();
            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: context },
                    { role: 'user', content: 'Please provide 3 response options.' }
                ],
                temperature: 0.9,
                max_tokens: 150
            });
            timings.llmApi = Date.now() - llmStartTime;

            // 8. PARSE RESPONSES
            const parseStartTime = Date.now();
            const responseText = completion.choices[0].message.content;
            const responses = this.parseResponses(responseText);
            timings.responseParsing = Date.now() - parseStartTime;
            
            // 9. SAVE TO CHAT HISTORY (non-blocking)
            const chatSaveStartTime = Date.now();
            const conversationPromise = this.chatHistoryService.saveConversation(
                person.id || 'other',
                person.name,
                person.notes || '',
                userMessage,
                responses,
                ragContext.length > 0 ? ragContext : null
            );
            timings.chatHistorySave = Date.now() - chatSaveStartTime;

            // Log context usage (non-timing)
            if (ragContext.length > 0) {
                logger.info(`RAG enhanced response: ${ragContext.length} knowledge sources used`);
            }
            if (chatHistoryContext.length > 0) {
                logger.info(`Chat history enhanced response: ${chatHistoryContext.length} previous exchanges used`);
            }

            // Wait for conversation save to get ID
            const conversation = await conversationPromise;
            
            return {
                conversationId: conversation.id,
                responses,
                personName: person.name,
                personNotes: person.notes,
                userMessage: userMessage,
                timings // Return timing data instead of logging it
            };
            
        } catch (error) {
            logger.error('LLM service error:', error);
            
            // Fallback responses
            return {
                conversationId: Date.now(),
                responses: [
                    "I understand.",
                    "Could you tell me more?",
                    "I'm here to help."
                ],
                personName: 'Other',
                personNotes: '',
                userMessage: userMessage,
                timings,
                error: error.message
            };
        }
    }

    async getEnhancedRAGContext(userMessage, person) {
        try {
            const ragResults = await getRAGContext(userMessage);
            
            if (ragResults && ragResults.length > 0) {
                return ragResults.map(result => ({
                    content: result.content,
                    source: result.metadata?.source || 'knowledge base',
                    relevance: result.score || 0
                }));
            }
            
            return [];
        } catch (error) {
            logger.error('Failed to get RAG context:', error);
            return [];
        }
    }

    buildContextMessage(userMessage, person, recentContext, ragContext, chatHistoryContext, sessionContext, personContext) {
        let context = this.systemPrompt;
        
        // Add person-specific context
        if (person.name !== 'Other') {
            context += `\n\nYou are talking with ${person.name}.`;
            if (person.notes) {
                context += ` Here's what you should know about them: ${person.notes}`;
            }
        }
        
        // Add recent conversation context
        if (recentContext && recentContext.length > 0) {
            context += '\n\nRecent conversation:';
            recentContext.forEach(exchange => {
                context += `\nUser: ${exchange.userMessage}`;
                context += `\nAssistant: ${exchange.selectedResponse}`;
            });
        }
        
        // Add session context (current conversation queue)
        if (sessionContext) {
            context += `\n\n${sessionContext}`;
        }
        
        // Add chat history context
        if (chatHistoryContext && chatHistoryContext.length > 0) {
            context += '\n\nRelevant past conversations:';
            chatHistoryContext.forEach(conv => {
                context += `\n- User: ${conv.userMessage} | Assistant: ${conv.selectedResponse}`;
            });
        }
        
        // Add RAG context
        if (ragContext && ragContext.length > 0) {
            context += '\n\nRelevant information from knowledge base:';
            ragContext.forEach(item => {
                context += `\n- ${item.content} (from: ${item.source})`;
            });
        }
        
        // Add extended person context if available
        if (personContext?.extendedContext) {
            context += `\n\n${personContext.extendedContext}`;
        }
        
        context += `\n\nCurrent message from user: "${userMessage}"`;
        
        return context;
    }

    parseResponses(responseText) {
        // Try to parse numbered responses
        const lines = responseText.split('\n').filter(line => line.trim());
        const responses = [];
        
        for (const line of lines) {
            // Match patterns like "1.", "1)", "- ", or just take the line
            const match = line.match(/^(?:\d+[\.)]\s*|-\s*)?(.+)$/);
            if (match && match[1].trim()) {
                responses.push(match[1].trim());
            }
        }
        
        // Ensure we have exactly 3 responses
        while (responses.length < 3) {
            responses.push("I understand.");
        }
        
        return responses.slice(0, 3);
    }

    async selectResponse(conversationId, responseText) {
        try {
            await this.chatHistoryService.updateSelectedResponse(conversationId, responseText);
            logger.info(`Response selected for conversation ${conversationId}`);
        } catch (error) {
            logger.error('Failed to update selected response:', error);
        }
    }

    // Additional methods remain unchanged...
    async getConversationHistory(personName, limit = 10) {
        try {
            return await this.chatHistoryService.getRecentExchanges(personName, limit);
        } catch (error) {
            logger.error('Failed to get conversation history:', error);
            return [];
        }
    }

    async searchKnowledge(query) {
        try {
            return await getRAGContext(query);
        } catch (error) {
            logger.error('Failed to search knowledge:', error);
            return [];
        }
    }
}

module.exports = LLMService;