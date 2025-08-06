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

    // Append search instructions to the system prompt
    appendSearchInstructions(systemPrompt) {
        const searchInstructions = `

When the user asks about current events, recent information, or anything that requires up-to-date knowledge, 
you will automatically have access to web search results. Use this information to provide accurate, current responses.

IMPORTANT FORMATTING RULES FOR VOICE OUTPUT:
- Never include URLs, links, or web addresses in your response
- Do not use markdown formatting like [text](url)
- Avoid citation numbers or references like [1], (1), or superscripts
- Do not mention sources inline - focus on the information itself
- Keep responses concise and natural for text-to-speech
- Use simple, clear language suitable for voice synthesis
- Never mention that you performed a search - just integrate the information naturally into your response
- Avoid phrases like "according to my search" or "I found online"
- Present information as direct statements without attribution markers

Remember: The user is using voice/eye-gaze technology, so the response must be clean, natural speech without any visual formatting or references.`;

        return systemPrompt + searchInstructions;
    }

    // Clean response to remove any search artifacts
    cleanResponse(text) {
        if (!text) return text;
        
        // Remove markdown links [text](url) -> text
        text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        
        // Remove standalone URLs (http/https)
        text = text.replace(/https?:\/\/[^\s<>"\{\}\|\\^\[\]`]+/g, '');
        
        // Remove citation numbers in various formats
        // Removes patterns like [1], (1), <1>, {1}, ¹, ², ³, etc.
        text = text.replace(/[\[\(\{\<]\d+[\]\)\}\>]/g, '');
        text = text.replace(/[\u00B9\u00B2\u00B3\u2074-\u2079\u2070]/g, ''); // Superscript numbers
        
        // Remove any remaining citation-style references like "Source: ..."
        text = text.replace(/\(Source:.*?\)/gi, '');
        text = text.replace(/Source:\s*[^\n\.]*/gi, '');
        
        // Remove any search-related mentions (existing logic)
        text = text.replace(/I (searched|looked up|found online|checked the internet)[\s\S]*?\./gi, '');
        text = text.replace(/According to (my search|the search results|online sources)[\s\S]*?,/gi, '');
        
        // Remove any brackets with just whitespace or dots
        text = text.replace(/\[[\.:\s]*\]/g, '');
        text = text.replace(/\([\.:\s]*\)/g, '');
        
        // Clean up any double spaces created by removals
        text = text.replace(/\s{2,}/g, ' ');
        
        // Remove multiple consecutive newlines
        text = text.replace(/\n{3,}/g, '\n\n');
        
        // Trim whitespace
        return text.trim();
    }

    async generateResponses(userMessage, personId = 'other', socketId = null) {
        const timings = {}; // Collect all timing data to return
        
        try {
            // 1-5. GET ALL CONTEXT (same as before)
            const personStartTime = Date.now();
            const personContext = await dataStore.getPersonContext(personId);
            const person = personContext?.person || { name: 'Other', notes: '' };
            timings.personLookup = Date.now() - personStartTime;

            const recentStartTime = Date.now();
            const recentContext = await this.chatHistoryService.getRecentExchanges(person.name, 4);
            timings.recentContext = Date.now() - recentStartTime;
            
            const sessionStartTime = Date.now();
            const sessionContext = socketId ? sessionQueueManager.buildSessionContext(socketId) : '';
            timings.sessionContext = Date.now() - sessionStartTime;
            
            const ragStartTime = Date.now();
            const ragContext = await this.getEnhancedRAGContext(userMessage, person);
            timings.ragLookup = Date.now() - ragStartTime;

            const chatHistoryStartTime = Date.now();
            const chatHistoryContext = await this.chatHistoryService.searchChatHistory(userMessage, person.name, 2, 0.3);
            timings.chatHistorySearch = Date.now() - chatHistoryStartTime;
            
            // 6. BUILD CONTEXT MESSAGE
            const buildStartTime = Date.now();
            let systemPromptContent = this.buildContextMessage(userMessage, person, recentContext, ragContext, chatHistoryContext, sessionContext, personContext);
            
            // Get settings from dataStore
            const settings = await dataStore.getSettings();
            const customSystemPrompt = settings?.llm?.systemPrompt || this.systemPrompt;
            systemPromptContent = customSystemPrompt + '\n\n' + systemPromptContent;
            
            // Append search instructions if search is enabled
            const searchEnabled = settings?.internetSearch?.enabled !== false; // Default to true
            if (searchEnabled) {
                systemPromptContent = this.appendSearchInstructions(systemPromptContent);
            }
            
            timings.messageBuilding = Date.now() - buildStartTime;
            
            // 7. USE RESPONSES API WITH WEB SEARCH
            const llmStartTime = Date.now();
            
            try {
                // Check if we're in manual mode (need multiple responses)
                if (socketId) {
                    // Manual mode - generate 3 responses
                    const responses = [];
                    
                    // Generate first response with potential web search
                    const response1 = await this.generateSingleResponse(
                        userMessage, 
                        systemPromptContent, 
                        settings, 
                        searchEnabled,
                        0.9
                    );
                    responses.push(response1);
                    
                    // Generate 2 more responses with slightly different temperatures
                    for (let i = 1; i < 3; i++) {
                        const response = await this.generateSingleResponse(
                            userMessage, 
                            systemPromptContent, 
                            settings, 
                            searchEnabled,
                            Math.min(1.5, 0.9 + i * 0.2)
                        );
                        if (!responses.includes(response)) {
                            responses.push(response);
                        }
                    }
                    
                    // Ensure we have 3 responses
                    while (responses.length < 3) {
                        responses.push("I understand. Please tell me more.");
                    }
                    
                    timings.llmApi = Date.now() - llmStartTime;
                    timings.responseParsing = 0; // No separate parsing needed
                    
                    // Save conversation and return
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
                    const response = await this.generateSingleResponse(
                        userMessage, 
                        systemPromptContent, 
                        settings, 
                        searchEnabled
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
                // Fallback to Chat Completions API if Responses API fails
                logger.warn('Responses API failed, falling back to Chat Completions API:', error);
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

    async generateSingleResponse(userMessage, systemPrompt, settings, searchEnabled, temperature = 0.9) {
        const tools = searchEnabled ? [{ type: "web_search_preview" }] : [];
        
        // Build the request payload
        const requestPayload = {
            model: settings?.llm?.model || process.env.LLM_MODEL || "gpt-4.1-mini",
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
            max_output_tokens: parseInt(settings?.llm?.maxTokens || process.env.LLM_MAX_TOKENS || 150)
        };
        
        // LOG THE EXACT REQUEST
        logger.info('=== OPENAI RESPONSES API REQUEST ===');
        logger.info(`Search Enabled: ${searchEnabled}`);
        logger.info(`Model: ${requestPayload.model}`);
        logger.info(`Temperature: ${requestPayload.temperature}`);
        logger.info(`Max Tokens: ${requestPayload.max_output_tokens}`);
        logger.info(`Tools: ${JSON.stringify(tools)}`);
        logger.info(`User Message: "${userMessage}"`);
        logger.info(`System Prompt Length: ${systemPrompt.length} characters`);
        //logger.info('Full Request Payload:', JSON.stringify(requestPayload, null, 2));
        
        try {
            const response = await this.openai.responses.create(requestPayload);
            
            // LOG THE RESPONSE
            logger.info('=== OPENAI RESPONSES API RESPONSE ===');
            logger.info(`Response ID: ${response.id}`);
            logger.info(`Output Text: "${response.output_text}"`);
            logger.info('Full Response:', JSON.stringify(response, null, 2));
            
            // The response.output_text contains the complete response with search results already integrated
            return this.cleanResponse(response.output_text);
        } catch (error) {
            logger.error('=== OPENAI RESPONSES API ERROR ===');
            logger.error('Error details:', error);
            throw error;
        }
    }

    // Fallback method using Chat Completions API (without web search)
    async fallbackToChatCompletions(userMessage, systemPrompt, settings, person, ragContext, timings, socketId) {
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
        ];
        
        const apiParams = {
            model: settings?.llm?.model || process.env.LLM_MODEL || 'gpt-4.1-mini',
            messages: messages,
            temperature: 0.9,
            max_tokens: parseInt(settings?.llm?.maxTokens || process.env.LLM_MAX_TOKENS || 150)
        };
        
        if (socketId) {
            // Manual mode - need 3 responses
            const responses = [];
            apiParams.n = 3;
            
            const completion = await this.openai.chat.completions.create(apiParams);
            for (const choice of completion.choices) {
                responses.push(this.cleanResponse(choice.message.content));
            }
            
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
        // Save to chat history
        const chatSaveStartTime = Date.now();
        const conversationPromise = this.chatHistoryService.saveConversation(
            person.id || 'other',
            person.name,
            person.notes || '',
            userMessage,
            responses,
            ragContext.length > 0 ? `Retrieved ${ragContext.length} knowledge items` : null
        );
        
        conversationPromise.catch(error => {
            logger.error('Failed to save conversation:', error);
        });
        
        timings.chatHistorySave = Date.now() - chatSaveStartTime;
        
        // If this is for the session queue, add the exchange
        if (socketId && responses.length > 0) {
            sessionQueueManager.addConversationExchange(socketId, userMessage, responses[0]);
        }
        
        const conversationId = await conversationPromise.then(
            result => result?.id || Date.now().toString(),
            () => Date.now().toString()
        );
        
        return {
            responses: responses,
            conversationId,
            personName: person.name,
            personNotes: person.notes,
            timings
        };
    }

    // Keep all other methods unchanged
    async getEnhancedRAGContext(query, person) {
        try {
            const results = await getRAGContext(query);
            
            if (person && person.name !== 'Other') {
                results.sort((a, b) => {
                    const aHasPerson = a.metadata?.tags?.includes(person.name);
                    const bHasPerson = b.metadata?.tags?.includes(person.name);
                    if (aHasPerson && !bHasPerson) return -1;
                    if (!aHasPerson && bHasPerson) return 1;
                    return 0;
                });
            }
            
            return results.slice(0, 3).map(result => ({
                content: result.content,
                source: result.metadata?.source || 'knowledge base'
            }));
        } catch (error) {
            logger.error('Failed to get RAG context:', error);
            return [];
        }
    }

    buildContextMessage(userMessage, person, recentContext, ragContext, chatHistoryContext, sessionContext, personContext) {
        let context = '';
        
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
        
        // Add session context
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
        
        return context;
    }

    async selectResponse(conversationId, responseText) {
        try {
            await this.chatHistoryService.updateSelectedResponse(conversationId, responseText);
            logger.info(`Response selected for conversation ${conversationId}`);
        } catch (error) {
            logger.error('Failed to update selected response:', error);
        }
    }

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