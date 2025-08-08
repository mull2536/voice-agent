// server/services/llm.js
const { OpenAI } = require('openai');
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
        text = text.replace(/\[\d+\]/g, '');
        text = text.replace(/\(\d+\)/g, '');
        text = text.replace(/\<\d+\>/g, '');
        text = text.replace(/\{\d+\}/g, '');
        text = text.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, '');
        
        // Remove "according to" phrases that reference searches
        text = text.replace(/according to (?:my |the )?(?:search|results|findings|web|internet|online sources)[^,.]*/gi, '');
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
        const timings = {};
        
        try {
            // 1. LOOK UP PERSON DETAILS
            const personStartTime = Date.now();
            const person = await dataStore.findPersonById(personId);
            timings.personLookup = Date.now() - personStartTime;
            
            // 2. GET RECENT CONTEXT FROM SESSION QUEUE
            const recentStartTime = Date.now();
            const recentContext = socketId ? 
                sessionQueueManager.getConversationExchanges(socketId) : [];
            timings.recentContext = Date.now() - recentStartTime;
            
            // 3. GET SESSION CONVERSATION CONTEXT
            const sessionStartTime = Date.now();
            const sessionContext = socketId ? 
                sessionQueueManager.getConversationExchanges(socketId) : [];
            timings.sessionContext = Date.now() - sessionStartTime;
            
            // 4. GET RAG CONTEXT
            const ragStartTime = Date.now();
            const ragContext = await getRAGContext(userMessage);
            timings.ragLookup = Date.now() - ragStartTime;
            
            // 5. GET RELEVANT CHAT HISTORY
            const chatHistoryStartTime = Date.now();
            const chatHistoryContext = await this.chatHistoryService.searchRelevantHistory(
                personId,
                userMessage,
                5  // Get top 5 relevant past conversations
            );
            timings.chatHistorySearch = Date.now() - chatHistoryStartTime;
            
            // 6. GET PERSON-SPECIFIC CONTEXT
            const personContext = person ? 
                await this.chatHistoryService.getPersonContext(personId, 3) : null;
            
            // 7. BUILD CONTEXT MESSAGE
            const buildStartTime = Date.now();
            let systemPromptContent = this.buildContextMessage(
                userMessage, 
                person, 
                recentContext, 
                ragContext, 
                chatHistoryContext, 
                sessionContext, 
                personContext
            );
            
            // Get settings from dataStore
            const settings = await dataStore.getSettings();
            
            // Use custom system prompt if provided, otherwise use default
            const customSystemPrompt = settings?.llm?.systemPrompt || '';
            const baseSystemPrompt = customSystemPrompt.trim() || this.defaultSystemPrompt;
            
            // Add language instruction based on default language setting
            const defaultLanguage = settings?.system?.defaultLanguage || 'en';
            const languageInstruction = this.getLanguageInstruction(defaultLanguage);
            
            // Combine prompts: base + language + context
            systemPromptContent = baseSystemPrompt + languageInstruction + '\n\n' + systemPromptContent;
            
            // Append search instructions if search is enabled
            const searchEnabled = settings?.internetSearch?.enabled !== false; // Default to true
            if (searchEnabled) {
                systemPromptContent = this.appendSearchInstructions(systemPromptContent);
            }
            
            logger.info(`Using language: ${defaultLanguage}, Search enabled: ${searchEnabled}`);
            
            timings.messageBuilding = Date.now() - buildStartTime;
            
            // 8. USE RESPONSES API WITH WEB SEARCH
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
            model: settings?.llm?.model || config.llm.model || "gpt-4.1-mini",
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
        
        // LOG THE EXACT REQUEST
        logger.info('=== OPENAI RESPONSES API REQUEST ===');
        logger.info(`Search Enabled: ${searchEnabled}`);
        logger.info(`Model: ${requestPayload.model}`);
        logger.info(`Temperature: ${requestPayload.temperature}`);
        logger.info(`Max Tokens: ${requestPayload.max_output_tokens}`);
        logger.info(`Tools: ${JSON.stringify(tools)}`);
        logger.info(`User Message: "${userMessage}"`);
        logger.info(`System Prompt Length: ${systemPrompt.length} characters`);
        
        try {
            const response = await this.openai.responses.create(requestPayload);
            
            // LOG THE RESPONSE
            logger.info('=== OPENAI RESPONSES API RESPONSE ===');
            logger.info(`Response ID: ${response.id}`);
            logger.info(`Output Text: "${response.output_text?.substring(0, 100)}..."`);
            // Don't log full response to avoid verbose output
            
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
            model: settings?.llm?.model || config.llm.model || 'gpt-4.1-mini',
            messages: messages,
            temperature: 0.9,
            max_tokens: parseInt(settings?.llm?.maxTokens || config.llm.maxTokens || 150)
        };
        
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
        
        const conversationEntry = {
            id: conversationId,
            timestamp: new Date().toISOString(),
            personId: person?.id || 'other',
            personName: person?.name || 'Other',
            userMessage: userMessage,
            responses: responses,
            selectedResponse: null,
            ragContext: ragContext.map(r => ({
                content: r.content.substring(0, 200) + '...',
                source: r.metadata?.filename || r.metadata?.source || 'unknown'
            }))
        };
        
        await dataStore.addConversation(conversationEntry);
        timings.chatHistorySave = Date.now() - saveStartTime;
        
        // RETURN STRUCTURED RESPONSE
        return {
            responses: responses,
            conversationId: conversationId,
            personName: person?.name || 'Other',
            personNotes: person?.notes || '',
            timings: timings
        };
    }

    async selectResponse(conversationId, selectedText) {
        try {
            // Update the conversation with the selected response
            const conversations = await dataStore.getConversations();
            const conversation = conversations.find(c => c.id === conversationId);
            
            if (conversation) {
                conversation.selectedResponse = selectedText;
                await dataStore.updateConversation(conversationId, conversation);
                logger.info(`Response selected for conversation ${conversationId}`);
            }
        } catch (error) {
            logger.error('Failed to save selected response:', error);
        }
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