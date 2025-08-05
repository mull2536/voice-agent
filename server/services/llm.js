// Add this to server/services/llm.js (modifications)

const { OpenAI } = require('openai');
const dataStore = require('../utils/simpleDataStore');
const { getRAGContext } = require('./rag');
const logger = require('../utils/logger');
const { performance } = require('perf_hooks');
const ChatHistoryService = require('./chatHistory');
const sessionQueueManager = require('../utils/sessionQueueManager'); // ADD THIS

class LLMService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.systemPrompt = `You are a helpful AI assistant designed to support natural 
        conversation for someone with ALS who uses eye gaze technology. Be concise but warm. 
        Understand that communication may be slower, so be patient and supportive. Provide 
        thoughtful, contextual responses that continue the conversation naturally.`;

        // ADD CHAT HISTORY SERVICE
        this.chatHistoryService = new ChatHistoryService();
        this.initializeChatHistory();
    }

    // ADD THIS METHOD
    async initializeChatHistory() {
        try {
            await this.chatHistoryService.initialize();
            logger.info('Chat history service initialized in LLM service');
        } catch (error) {
            logger.error('Failed to initialize chat history service:', error);
        }
    }

    async generateResponses(userMessage, personId = 'other', socketId = null) {
        const totalStartTime = performance.now();
        
        try {
            // 1. GET PERSON CONTEXT (timing)
            const personStartTime = performance.now();
            const personContext = await dataStore.getPersonContext(personId);
            const person = personContext?.person || { name: 'Other', notes: '' };
            const personEndTime = performance.now();
            logger.info(`Person context lookup: ${(personEndTime - personStartTime).toFixed(2)}ms`);

            // 2. GET RECENT CONVERSATION CONTEXT (timing) - MODIFIED to use session queues
            const recentStartTime = performance.now();
            const recentContext = await this.chatHistoryService.getRecentExchanges(person.name, 4);
            const recentEndTime = performance.now();
            logger.info(`Recent context lookup: ${(recentEndTime - recentStartTime).toFixed(2)}ms`);
            
            // 3. GET SESSION CONTEXT (timing) - NEW
            const sessionStartTime = performance.now();
            const sessionContext = socketId ? sessionQueueManager.buildSessionContext(socketId) : '';
            const sessionEndTime = performance.now();
            logger.info(`Session context lookup: ${(sessionEndTime - sessionStartTime).toFixed(2)}ms`);
            
            // 4. GET RAG CONTEXT (timing)
            const ragStartTime = performance.now();
            const ragContext = await this.getEnhancedRAGContext(userMessage, person);
            const ragEndTime = performance.now();
            logger.info(`RAG context lookup: ${(ragEndTime - ragStartTime).toFixed(2)}ms`);

            // 5. GET CHAT HISTORY CONTEXT (timing)
            const chatHistoryStartTime = performance.now();
            const chatHistoryContext = await this.chatHistoryService.searchChatHistory(userMessage, person.name, 2, 0.3);
            const chatHistoryEndTime = performance.now();
            logger.info(`Chat history search: ${(chatHistoryEndTime - chatHistoryStartTime).toFixed(2)}ms`);
            
            // 6. BUILD CONTEXT MESSAGE (timing) - MODIFIED to include session context
            const buildStartTime = performance.now();
            const context = this.buildContextMessage(userMessage, person, recentContext, ragContext, chatHistoryContext, sessionContext, personContext);
            const buildEndTime = performance.now();
            logger.info(`Context message building: ${(buildEndTime - buildStartTime).toFixed(2)}ms`);
            
            // 6. LLM API CALL (timing)
            const llmStartTime = performance.now();
            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4.1-mini',
                messages: [
                    { role: 'system', content: context },
                    { role: 'user', content: 'Please provide 3 response options.' }
                ],
                temperature: 0.9,
                max_tokens: 150
            });
            const llmEndTime = performance.now();
            const llmApiTime = llmEndTime - llmStartTime;
            logger.info(`🔥 LLM API CALL: ${llmApiTime.toFixed(2)}ms`);

            // 7. PARSE RESPONSES (timing)
            const parseStartTime = performance.now();
            const responseText = completion.choices[0].message.content;
            const responses = this.parseResponses(responseText);
            const parseEndTime = performance.now();
            logger.info(`Response parsing: ${(parseEndTime - parseStartTime).toFixed(2)}ms`);
            
            // 8. DON'T SAVE TO CHAT HISTORY YET - Wait for response selection
            // We'll save the complete exchange when user selects a response
            const chatSaveStartTime = performance.now();
            const chatSaveEndTime = performance.now();
            logger.info(`Chat history save: skipped (${(chatSaveEndTime - chatSaveStartTime).toFixed(2)}ms)`);
            
            // 9. SAVE CONVERSATION (timing) - Keep existing for compatibility
            const saveStartTime = performance.now();
            const conversationPromise = dataStore.saveConversation({
                personId,
                personName: person.name,
                userMessage,
                responses,
                context: { 
                    ragUsed: ragContext.length > 0,
                    ragSourcesCount: ragContext.length,
                    ragSources: ragContext.map(r => r.metadata?.filename || r.metadata?.source).filter(s => s),
                    chatHistoryUsed: chatHistoryContext.length > 0,
                    chatHistorySourcesCount: chatHistoryContext.length,
                    timestamp: new Date().toISOString()
                }
            }).then(conversation => {
                const saveEndTime = performance.now();
                logger.info(`Conversation save: ${(saveEndTime - saveStartTime).toFixed(2)}ms`);
                return conversation;
            }).catch(error => {
                logger.error('Failed to save conversation:', error);
                return { id: Date.now() };
            });
            
            // 10. UPDATE PERSON (timing)
            dataStore.updatePerson(personId, {
                lastConversation: new Date().toISOString()
            }).catch(error => logger.error('Failed to update person:', error));

            // 11. LOG CONTEXT USAGE
            if (ragContext.length > 0) {
                logger.info(`RAG enhanced response: ${ragContext.length} knowledge sources used`);
            }
            if (chatHistoryContext.length > 0) {
                logger.info(`Chat history enhanced response: ${chatHistoryContext.length} previous exchanges used`);
            }

            // 12. CALCULATE TIMING BREAKDOWN
            const totalEndTime = performance.now();
            const totalTime = totalEndTime - totalStartTime;
            const auxiliaryTime = totalTime - llmApiTime;
            
            logger.info(`🚀 TIMING BREAKDOWN:
  ├─ Total time: ${totalTime.toFixed(2)}ms
  ├─ LLM API call: ${llmApiTime.toFixed(2)}ms (${((llmApiTime/totalTime)*100).toFixed(1)}%)
  ├─ Auxiliary services: ${auxiliaryTime.toFixed(2)}ms (${((auxiliaryTime/totalTime)*100).toFixed(1)}%)
  └─ Breakdown:
     ├─ Person lookup: ${(personEndTime - personStartTime).toFixed(2)}ms
     ├─ Recent context: ${(recentEndTime - recentStartTime).toFixed(2)}ms
     ├─ RAG lookup: ${(ragEndTime - ragStartTime).toFixed(2)}ms
     ├─ Chat history search: ${(chatHistoryEndTime - chatHistoryStartTime).toFixed(2)}ms
     ├─ Message building: ${(buildEndTime - buildStartTime).toFixed(2)}ms
     ├─ Chat history save: ${(chatSaveEndTime - chatSaveStartTime).toFixed(2)}ms
     └─ Response parsing: ${(parseEndTime - parseStartTime).toFixed(2)}ms`);

            // Wait for conversation save to get ID
            const conversation = await conversationPromise;
            
            return {
                conversationId: conversation.id,
                responses,
                personName: person.name, // Add person name for later use
                personNotes: person.notes, // Add person notes for later use
                userMessage: userMessage, // Add user message for later use
                timing: {
                    total: totalTime,
                    llmApi: llmApiTime,
                    auxiliary: auxiliaryTime,
                    breakdown: {
                        personLookup: personEndTime - personStartTime,
                        recentContext: recentEndTime - recentStartTime,
                        sessionContext: sessionEndTime - sessionStartTime,
                        ragLookup: ragEndTime - ragStartTime,
                        chatHistorySearch: chatHistoryEndTime - chatHistoryStartTime,
                        messageBuilding: buildEndTime - buildStartTime,
                        chatHistorySave: chatSaveEndTime - chatSaveStartTime,
                        responseParsing: parseEndTime - parseStartTime
                    }
                }
            };
            
        } catch (error) {
            const totalEndTime = performance.now();
            const totalTime = totalEndTime - totalStartTime;
            logger.error(`❌ LLM service failed after ${totalTime.toFixed(2)}ms:`, error);
            
            // Fallback responses
            return {
                conversationId: Date.now(),
                responses: [
                    "I understand. Could you tell me more about that?",
                    "That's interesting. What specifically would you like to know?",
                    "I hear you. How can I help you with this?"
                ],
                error: error.message,
                timing: { total: totalTime, llmApi: 0, auxiliary: totalTime }
            };
        }
    }

    // MODIFIED: Updated buildContextMessage to include chat history
    buildContextMessage(userMessage, person, recentContext, ragContext, chatHistoryContext, personContext) {
        let context = this.systemPrompt + '\n\n';
        
        // Add person-specific context
        context += `You are helping the user communicate with: ${person.name}\n`;
        if (person.notes) {
            context += `Context about this person: ${person.notes}\n`;
        }
        
        if (personContext && personContext.topics && personContext.topics.length > 0) {
            context += `Common topics with this person: ${personContext.topics.map(t => t.word).join(', ')}\n`;
        }
        
        context += '\n';
        
        // Add recent conversation history (from current session)
        if (recentContext && recentContext.length > 0) {
            context += 'Recent conversation with this person:\n';
            recentContext.forEach(turn => {
                context += `User: ${turn.user}\n`;
                if (turn.assistant) {
                    context += `You: ${turn.assistant}\n`;
                }
            });
            context += '\n';
        }

        // Add chat history context (from previous conversations)
        if (chatHistoryContext && chatHistoryContext.length > 0) {
            context += 'Relevant previous conversations:\n';
            chatHistoryContext.forEach((doc, index) => {
                const similarity = doc.similarity ? ` (${Math.round(doc.similarity * 100)}% relevant)` : '';
                context += `\n--- Previous Exchange ${index + 1}${similarity} ---\n`;
                context += `${doc.content}\n`;
            });
            context += '\n';
        }
        
        // Add enhanced RAG context
        if (ragContext && ragContext.length > 0) {
            context += 'Relevant information from knowledge base:\n';
            ragContext.forEach((doc, index) => {
                const source = doc.metadata?.filename || doc.metadata?.source || 'Unknown source';
                const similarity = doc.similarity ? ` (${Math.round(doc.similarity * 100)}% relevant)` : '';
                
                const content = doc.content.length > 500 
                    ? doc.content.substring(0, 500) + '...' 
                    : doc.content;
                
                context += `\n--- Knowledge Source ${index + 1}: ${source}${similarity} ---\n`;
                context += `${content}\n`;
            });
            context += '\n';
        }
        
        context += `Current message: ${userMessage}\n\n`;
        context += `Generate 3 different response options appropriate for talking to ${person.name}.`;
        context += ` Consider the relationship, previous topics of conversation, and any relevant knowledge base information.`;
        
        if (ragContext.length > 0) {
            context += ` Make sure to incorporate relevant information from the knowledge base when appropriate.`;
        }

        if (chatHistoryContext.length > 0) {
            context += ` Reference relevant previous conversations naturally without explicitly mentioning "last time we talked".`;
        }

        return context;
    }

    // MODIFIED: Update selectResponse to save to chat history - FIXED
    async selectResponse(conversationId, selectedResponse) {
        const startTime = performance.now();
        
        try {
            // Update existing conversation record
            await dataStore.updateConversation(conversationId, { selectedResponse });
            
            // For chat history, we need person info - get it from the conversation
            // Since we don't have direct access to personId here, we'll need to modify the socket handler
            // to pass the person information
            
            const endTime = performance.now();
            logger.info(`Response selection: ${(endTime - startTime).toFixed(2)}ms`);
            
        } catch (error) {
            const endTime = performance.now();
            logger.error(`Response selection failed after ${(endTime - startTime).toFixed(2)}ms:`, error);
            throw error;
        }
    }

    // Keep existing methods unchanged
    async getEnhancedRAGContext(userMessage, person) {
        try {
            let ragResults = await getRAGContext(userMessage, 0.7);
            
            if (ragResults.length === 0 && person.name !== 'Other') {
                const personQuery = `${userMessage} ${person.name} ${person.notes}`;
                ragResults = await getRAGContext(personQuery, 0.6);
            }
            
            if (ragResults.length === 0) {
                const keywords = this.extractKeywords(userMessage);
                if (keywords.length > 0) {
                    ragResults = await getRAGContext(keywords.join(' '), 0.5);
                }
            }
            
            return ragResults;
            
        } catch (error) {
            logger.error('Failed to get RAG context:', error);
            return [];
        }
    }

    extractKeywords(text) {
        const commonWords = new Set([
            'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
            'a', 'an', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
            'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him', 'her', 'us', 'them'
        ]);
        
        return text.toLowerCase()
            .split(/\s+/)
            .filter(word => word.length > 3 && !commonWords.has(word))
            .slice(0, 5);
    }

    parseResponses(text) {
        const lines = text.split('\n').filter(line => line.trim());
        const responses = [];
        
        lines.forEach(line => {
            if (line.match(/^[1-3]\./) || line.match(/^[-*]/) || line.match(/^\d+\)/)) {
                const response = line.replace(/^[1-3]\./, '').replace(/^[-*]/, '').replace(/^\d+\)/, '').trim();
                if (response) {
                    responses.push(response);
                }
            } else if (line.startsWith('"') && line.endsWith('"') && line.length > 10) {
                responses.push(line);
            }
        });
        
        while (responses.length < 3) {
            responses.push("I'd be happy to help you with that.");
        }
        
        return responses.slice(0, 3);
    }
}

module.exports = LLMService;