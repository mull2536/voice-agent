// server/services/llm.js
const { OpenAI } = require('openai');
const axios = require('axios');
const dataStore = require('../utils/simpleDataStore');
const { getRAGContext } = require('./rag');
const logger = require('../utils/logger');
const ChatHistoryService = require('./chatHistory');
const sessionQueueManager = require('../utils/sessionQueueManager');
const config = require('../config');

class LLMService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        // Default system prompt (used when settings.llm.systemPrompt is empty)
        this.defaultSystemPrompt = `You are a helpful AI assistant designed to support natural 
        conversation for someone with ALS who uses eye gaze technology. Be concise but warm. 
        Understand that communication may be slower, so be patient and supportive. Provide 
        thoughtful, contextual responses that continue the conversation naturally.
        Always speak in the first person ("I", "me", "my") as if you are a real person engaged in natural dialogue. 
        Never refer to yourself in the third person or as "the AI/assistant". 
        Be authentic and conversational.`;

        this.chatHistoryService = new ChatHistoryService();
        this.initializeChatHistory();
        
        // Socket reference for streaming (set by server)
        this.io = null;
    }

    // Set socket.io instance for streaming
    setSocketIO(io) {
        this.io = io;
    }

    async initializeChatHistory() {
        try {
            await this.chatHistoryService.initialize();
            logger.info('Chat history service initialized in LLM service');
        } catch (error) {
            logger.error('Failed to initialize chat history service:', error);
        }
    }

    // Get language instruction based on settings
    getLanguageInstruction(language) {
        const languageInstructions = {
            'en': '\n\nIMPORTANT: You MUST respond in English.',
            'nl': '\n\nIMPORTANT: You MUST respond in Dutch (Nederlands).',
            'es': '\n\nIMPORTANT: You MUST respond in Spanish (Español).'
        };
        
        return languageInstructions[language] || languageInstructions['en'];
    }

    // Append search instructions to the system prompt
    appendSearchInstructions(systemPrompt) {
        const searchInstructions = `

When the user asks about current events, recent information, or anything that requires up-to-date knowledge, 
you will automatically have access to web search results. Use this information to provide accurate, current responses.`;
        
        return systemPrompt + searchInstructions;
    }

    cleanResponse(text) {
        if (!text) return '';
        
        // Remove search-related artifacts
        text = text.replace(/\[\d+\]/g, ''); // Remove reference numbers
        text = text.replace(/†[a-z]/g, ''); // Remove other reference markers
        
        // Remove common AI phrases about searching
        text = text.replace(/(?:According to |Based on |From )(?:my |the )?(?:search|results|findings|web|internet|online sources)[^,.]*/gi, '');
        text = text.replace(/(?:I |I've |I have )?(?:searched|found|discovered|looked up)[^,.]*/gi, '');
        text = text.replace(/(?:from |based on |per )(?:my |the )?(?:search|results|findings|web|internet)[^,.]*/gi, '');
        
        // Remove double spaces and trim
        text = text.replace(/\s+/g, ' ').trim();
        
        return text;
    }

    buildContextMessage(userMessage, person, recentContext, ragContext, chatHistory, sessionContext, personContext) {
        let contextParts = [];
        
        // Add person context
        if (person) {
            if (person.name && person.name !== 'Other') {
                contextParts.push(`You are talking to ${person.name}.`);
            }
            if (person.notes) {
                contextParts.push(`About them: ${person.notes}`);
            }
            if (personContext) {
                contextParts.push(`Recent interactions: ${personContext}`);
            }
        }
        
        // Add session context (recent conversation in this session)
        if (sessionContext && sessionContext.length > 0) {
            contextParts.push('\nRecent conversation in this session:');
            sessionContext.forEach(exchange => {
                contextParts.push(`User: ${exchange.userMessage}`);
                contextParts.push(`Assistant: ${exchange.assistantResponse}`);
            });
        }
        
        // Add relevant chat history
        if (chatHistory && chatHistory.length > 0) {
            contextParts.push('\nRelevant conversation history:');
            chatHistory.forEach(entry => {
                contextParts.push(`[${entry.timestamp}] User: ${entry.userMessage}`);
                contextParts.push(`[${entry.timestamp}] Assistant: ${entry.assistantResponse}`);
            });
        }
        
        // Add RAG context
        if (ragContext && ragContext.length > 0) {
            contextParts.push('\nRelevant information from knowledge base:');
            ragContext.forEach(doc => {
                if (doc.metadata?.memory_title) {
                    contextParts.push(`Memory "${doc.metadata.memory_title}": ${doc.content}`);
                } else {
                    contextParts.push(`From ${doc.metadata?.filename || 'document'}: ${doc.content}`);
                }
            });
        }
        
        return contextParts.join('\n');
    }

    async generateResponses(userMessage, personId, socketId = null) {
        const timings = {
            personLookup: 0,
            sessionContext: 0,
            ragLookup: 0,
            chatHistorySearch: 0,
            personContext: 0,
            messageBuilding: 0,
            llmApi: 0,
            responseParsing: 0,
            chatHistorySave: 0,
            recentContext: 0
        };
        
        try {
            // 1. LOOK UP PERSON DETAILS
            const personStartTime = Date.now();
            const person = await dataStore.findPersonById(personId);
            timings.personLookup = Date.now() - personStartTime;
            
            // 2. GET SESSION CONTEXT (only once, not twice)
            const sessionStartTime = Date.now();
            const sessionContext = socketId ? 
                sessionQueueManager.getConversationExchanges(socketId) : [];
            timings.sessionContext = Date.now() - sessionStartTime;
            
            // 3. PARALLEL CONTEXT RETRIEVAL - RAG and Chat History
            const contextStartTime = Date.now();
            
            // Create promises with individual timing
            const ragPromise = (async () => {
                const ragStart = Date.now();
                const result = await getRAGContext(userMessage);
                timings.ragLookup = Date.now() - ragStart;
                return result;
            })();
            
            const chatHistoryPromise = (async () => {
                const chatStart = Date.now();
                const result = await this.chatHistoryService.searchRelevantHistory(personId, userMessage);
                timings.chatHistorySearch = Date.now() - chatStart;
                return result;
            })();
            
            // Wait for both to complete
            const [ragContext, chatHistoryContext] = await Promise.all([ragPromise, chatHistoryPromise]);
            
            // Log the actual individual times
            logger.info(`Context retrieval completed - RAG: ${timings.ragLookup}ms, Chat History: ${timings.chatHistorySearch}ms`);
            
            // 4. GET PERSON-SPECIFIC CONTEXT
            const personContextStartTime = Date.now();
            const personContext = person ? 
                await this.chatHistoryService.getPersonContext(personId) : null;
            timings.personContext = Date.now() - personContextStartTime;
            
            // 5. BUILD SYSTEM PROMPT
            const settings = await dataStore.getSettings();
            
            let systemPromptContent = settings?.llm?.systemPrompt || this.defaultSystemPrompt;
            
            // Add language instruction
            const language = settings?.llm?.responseLanguage || settings?.system?.defaultLanguage || 'en';
            systemPromptContent += this.getLanguageInstruction(language);
            
            // Add search instructions if enabled
            const searchEnabled = settings?.internetSearch?.enabled !== false;
            if (searchEnabled) {
                systemPromptContent = this.appendSearchInstructions(systemPromptContent);
            }
            
            // Add context to system prompt
            const contextMessage = this.buildContextMessage(
                userMessage, 
                person, 
                sessionContext, // Using sessionContext instead of duplicate recentContext
                ragContext, 
                chatHistoryContext, 
                sessionContext, 
                personContext
            );
            
            if (contextMessage) {
                systemPromptContent += '\n\nContext:\n' + contextMessage;
            }
            
            timings.messageBuilding = Date.now() - personContextStartTime;
            
            // 6. DETERMINE MODEL AND STREAMING PREFERENCES
            const modelName = settings?.llm?.model || config.llm.model || 'gpt-4.1-mini';
            const streamingEnabled = settings?.llm?.streaming !== false;
            
            // 7. GENERATE RESPONSES BASED ON MODE
            const llmStartTime = Date.now();
            
            try {
                // Check if we're in manual mode (need multiple responses)
                if (socketId) {
                    // Manual mode - generate 3 responses in PARALLEL
                    const temperatures = [0.9, 1.1, 1.3];
                    
                    const responsePromises = temperatures.map((temp, index) => 
                        this.generateSingleResponse(
                            userMessage, 
                            systemPromptContent, 
                            settings, 
                            searchEnabled,
                            temp,
                            streamingEnabled && index === 0, // Only stream first response
                            socketId
                        )
                    );
                    
                    const responses = await Promise.all(responsePromises);
                    
                    // Ensure uniqueness and we have 3 responses
                    const uniqueResponses = [...new Set(responses)];
                    while (uniqueResponses.length < 3) {
                        uniqueResponses.push("I understand. Please tell me more.");
                    }
                    
                    timings.llmApi = Date.now() - llmStartTime;
                    timings.responseParsing = 0;
                    
                    return await this.finalizeResponses(
                        uniqueResponses.slice(0, 3),
                        person,
                        userMessage,
                        ragContext,
                        timings,
                        socketId
                    );
                    
                } else {
                    // Auto mode - single response with streaming
                    const response = await this.generateSingleResponse(
                        userMessage, 
                        systemPromptContent, 
                        settings, 
                        searchEnabled,
                        0.9,
                        streamingEnabled,
                        socketId
                    );
                    
                    timings.llmApi = Date.now() - llmStartTime;
                    timings.responseParsing = 0;
                    
                    return await this.finalizeResponses(
                        [response],
                        person,
                        userMessage,
                        ragContext,
                        timings,
                        socketId
                    );
                }
                
            } catch (error) {
                // Fallback to Chat Completions API if primary API fails
                logger.warn('Primary API failed, falling back:', error);
                return await this.fallbackToChatCompletions(
                    userMessage,
                    systemPromptContent,
                    settings,
                    person,
                    ragContext,
                    timings,
                    socketId
                );
            }
            
        } catch (error) {
            logger.error('Failed to generate responses:', error);
            throw error;
        }
    }

    async generateSingleResponse(userMessage, systemPrompt, settings, searchEnabled, temperature = 0.9, streamingEnabled = false, socketId = null) {
        const modelName = settings?.llm?.model || config.llm.model || "gpt-4.1-mini";
        
        const useResponsesAPI = modelName.includes('gpt-5') || modelName.includes('gpt-4.1');
        
        // Determine if we should use streaming (only for non-Responses API and if enabled)
        const shouldStream = streamingEnabled && !useResponsesAPI && socketId && this.io;
        
        if (useResponsesAPI) {
            // Use Responses API (doesn't support streaming yet)
            return await this.generateWithResponsesAPI(userMessage, systemPrompt, settings, searchEnabled, temperature);
        } else if (shouldStream) {
            // Use streaming Chat Completions API
            return await this.generateWithStreaming(userMessage, systemPrompt, settings, temperature, socketId);
        } else {
            // Use regular Chat Completions API
            return await this.generateWithChatCompletions(userMessage, systemPrompt, settings, temperature);
        }
    }

    // OpenAI generation methods
    async generateWithResponsesAPI(userMessage, systemPrompt, settings, searchEnabled, temperature) {
        const modelName = settings?.llm?.model || config.llm.model || "gpt-4.1-mini";
        const isGPT5ChatLatest = modelName === 'gpt-5-chat-latest';
        
        // Determine tools - GPT-5 chat latest doesn't support web search
        const tools = (searchEnabled && !isGPT5ChatLatest) ? 
            [{ type: "web_search_preview" }] : [];
        
        // Build the request payload
        const requestPayload = {
            model: modelName,
            input: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user", 
                    content: userMessage
                }
            ],
            tools: tools,
            temperature: temperature,
            max_output_tokens: parseInt(settings?.llm?.maxTokens || config.llm.maxTokens || 150)
        };
        
        // Log if web search was disabled for GPT-5
        if (searchEnabled && isGPT5ChatLatest) {
            logger.info('Web search disabled for gpt-5-chat-latest (not supported)');
        }
        
        logger.info('Using Responses API with settings:', {
            model: modelName,
            temperature,
            searchEnabled: searchEnabled && !isGPT5ChatLatest,
            maxTokens: requestPayload.max_output_tokens
        });
        
        try {
            const response = await this.openai.responses.create(requestPayload);
            return this.cleanResponse(response.output_text);
        } catch (error) {
            logger.error('Responses API error:', error);
            throw error;
        }
    }

    async generateWithStreaming(userMessage, systemPrompt, settings, temperature, socketId) {
        const modelName = settings?.llm?.model || config.llm.model || "gpt-4.1-mini";
        
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ];
        
        try {
            logger.info('Starting OpenAI streaming response generation');
            
            const stream = await this.openai.chat.completions.create({
                model: modelName,
                messages: messages,
                temperature: temperature,
                max_tokens: parseInt(settings?.llm?.maxTokens || config.llm.maxTokens || 150),
                stream: true
            });
            
            let fullResponse = '';
            
            // Emit streaming chunks
            for await (const chunk of stream) {
                const token = chunk.choices[0]?.delta?.content || '';
                if (token) {
                    fullResponse += token;
                    
                    // Emit partial response to specific socket
                    if (this.io && socketId) {
                        this.io.to(socketId).emit('partial-response', {
                            text: fullResponse,
                            isComplete: false
                        });
                    }
                }
            }
            
            // Emit completion signal
            if (this.io && socketId) {
                this.io.to(socketId).emit('partial-response', {
                    text: fullResponse,
                    isComplete: true
                });
            }
            
            logger.info('OpenAI streaming response completed');
            return this.cleanResponse(fullResponse);
            
        } catch (error) {
            logger.error('OpenAI streaming generation error:', error);
            throw error;
        }
    }

    async generateWithChatCompletions(userMessage, systemPrompt, settings, temperature) {
        const modelName = settings?.llm?.model || config.llm.model || "gpt-4.1-mini";
        
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ];
        
        const apiParams = {
            model: modelName,
            messages: messages,
            temperature: temperature,
            max_tokens: parseInt(settings?.llm?.maxTokens || config.llm.maxTokens || 150)
        };
        
        try {
            const completion = await this.openai.chat.completions.create(apiParams);
            return this.cleanResponse(completion.choices[0].message.content);
        } catch (error) {
            logger.error('Chat Completions API error:', error);
            throw error;
        }
    }

    // Fallback method using Chat Completions API (without web search)
    async fallbackToChatCompletions(userMessage, systemPrompt, settings, person, ragContext, timings, socketId) {
        const modelName = settings?.llm?.model || config.llm.model || 'gpt-4.1-mini';
        const isGPT5ChatLatest = modelName === 'gpt-5-chat-latest';
        
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ];
        
        const apiParams = {
            model: modelName,
            messages: messages,
            temperature: 0.9
        };
        
        // Use correct token parameter based on model
        if (isGPT5ChatLatest) {
            // GPT-5 chat latest uses max_completion_tokens
            apiParams.max_completion_tokens = parseInt(settings?.llm?.maxTokens || config.llm.maxTokens || 150);
        } else {
            // Other models use max_tokens
            apiParams.max_tokens = parseInt(settings?.llm?.maxTokens || config.llm.maxTokens || 150);
        }
        
        if (socketId) {
            // Manual mode - need 3 responses
            const responses = [];
            apiParams.n = 3;
            
            const completion = await this.openai.chat.completions.create(apiParams);
            
            for (const choice of completion.choices) {
                responses.push(this.cleanResponse(choice.message.content));
            }
            
            // Ensure we have 3 responses
            while (responses.length < 3) {
                responses.push("I understand. Please tell me more.");
            }
            
            timings.llmApi = Date.now() - (timings.messageBuilding + Date.now());
            
            return await this.finalizeResponses(
                responses.slice(0, 3),
                person,
                userMessage,
                ragContext,
                timings,
                socketId
            );
        } else {
            // Auto mode - single response
            const completion = await this.openai.chat.completions.create(apiParams);
            const response = this.cleanResponse(completion.choices[0].message.content);
            
            timings.llmApi = Date.now() - (timings.messageBuilding + Date.now());
            
            return await this.finalizeResponses(
                [response],
                person,
                userMessage,
                ragContext,
                timings,
                socketId
            );
        }
    }

    async finalizeResponses(responses, person, userMessage, ragContext, timings, socketId) {
        // 9. SAVE TO CONVERSATION HISTORY
        const saveStartTime = Date.now();
        const conversationId = Date.now().toString();
        
        // ALSO save to chat history with null assistant response
        await this.chatHistoryService.saveConversation(
            person?.id || 'other',
            person?.name || 'Other', 
            person?.notes || '',
            userMessage,  // This parameter name is correct
            null  // assistant response is null until selected
        );
        
        timings.chatHistorySave = Date.now() - saveStartTime;
        const settings = await dataStore.getSettings();
        const modelName = settings?.llm?.model || config.llm.model || 'gpt-4.1-mini';
        
        // RETURN STRUCTURED RESPONSE
        return {
            responses: responses,
            conversationId: conversationId,
            personName: person?.name || 'Other',
            personNotes: person?.notes || '',
            timings: timings,
            llmModel: modelName, 
            internetSearch: settings?.internetSearch?.enabled !== false
        };
    }

    async selectResponse(conversationId, selectedText) {
        // No longer needed - chat history is updated in socket handler
        logger.info(`Response selected for conversation ${conversationId}`);
    }

    // Clean up old sessions periodically
    cleanupSessions() {
        try {
            // Log current session count for monitoring
            const sessionCount = sessionQueueManager.getSessionCount();
            if (sessionCount > 0) {
                logger.info(`Active sessions in queue manager: ${sessionCount}`);
            }
            
            // The sessionQueueManager already handles cleanup when sockets disconnect
            // No additional cleanup needed here
        } catch (error) {
            logger.error('Error in LLM cleanup check:', error);
        }
    }
}

module.exports = LLMService;

// At the bottom of llm.js, add:
module.exports.getChatHistoryService = function() {
    // Access the global llmService instance from the main server
    // This will be set after the server initializes
    if (global.llmService && global.llmService.chatHistoryService) {
        return global.llmService.chatHistoryService;
    }
    
    // Fallback: create a temporary instance if global is not available
    logger.warn('Global llmService not available, creating temporary instance');
    const tempInstance = new LLMService();
    return tempInstance.chatHistoryService;
};