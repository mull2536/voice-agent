const { OpenAI } = require('openai');
const dataStore = require('../utils/simpleDataStore');
const { getRAGContext } = require('./rag');
const logger = require('../utils/logger');

class LLMService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        this.systemPrompt = `You are a helpful AI assistant designed to support natural 
        conversation for someone with ALS who uses eye gaze technology. Be concise but warm. 
        Understand that communication may be slower, so be patient and supportive. Provide 
        thoughtful, contextual responses that continue the conversation naturally.`;
    }

    async generateResponses(userMessage, personId = 'other') {
        try {
            // Get person context
            const personContext = await dataStore.getPersonContext(personId);
            const person = personContext?.person || { name: 'Other', notes: '' };
            
            // Get recent conversation context (with this person specifically)
            const recentContext = await dataStore.getRecentContext(24, personId);
            
            // Get RAG context with improved search and formatting
            const ragContext = await this.getEnhancedRAGContext(userMessage, person);
            
            // Build enhanced context message
            const context = this.buildContextMessage(userMessage, person, recentContext, ragContext, personContext);
            
            // Generate responses
            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4-0125-preview',
                messages: [
                    { role: 'system', content: context },
                    { role: 'user', content: 'Please provide 3 response options.' }
                ],
                temperature: 0.8,
                max_tokens: 500
            });

            // Parse the response to get 3 options
            const responseText = completion.choices[0].message.content;
            const responses = this.parseResponses(responseText);
            
            // Save the conversation with RAG metadata
            const conversation = await dataStore.saveConversation({
                personId,
                personName: person.name,
                userMessage,
                responses,
                context: { 
                    ragUsed: ragContext.length > 0,
                    ragSourcesCount: ragContext.length,
                    ragSources: ragContext.map(r => r.metadata?.filename || r.metadata?.source).filter(s => s)
                }
            });
            
            // Update person's last conversation time
            await dataStore.updatePerson(personId, {
                lastConversation: new Date().toISOString()
            });
            
            // Log RAG usage for debugging
            if (ragContext.length > 0) {
                logger.info(`RAG enhanced response: ${ragContext.length} knowledge sources used`);
            }
            
            return {
                conversationId: conversation.id,
                responses
            };
            
        } catch (error) {
            logger.error('Failed to generate responses:', error);
            
            // Fallback responses
            return {
                conversationId: Date.now(),
                responses: [
                    "I understand. Could you tell me more about that?",
                    "That's interesting. What specifically would you like to know?",
                    "I hear you. How can I help you with this?"
                ]
            };
        }
    }

    async getEnhancedRAGContext(userMessage, person) {
        try {
            // Search with the user's message
            let ragResults = await getRAGContext(userMessage, 0.7);
            
            // If no results with high similarity, try with person's name/context
            if (ragResults.length === 0 && person.name !== 'Other') {
                const personQuery = `${userMessage} ${person.name} ${person.notes}`;
                ragResults = await getRAGContext(personQuery, 0.6);
            }
            
            // If still no results, try with just keywords from the message
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
        // Simple keyword extraction - remove common words
        const commonWords = new Set([
            'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
            'a', 'an', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
            'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him', 'her', 'us', 'them'
        ]);
        
        return text.toLowerCase()
            .split(/\s+/)
            .filter(word => word.length > 3 && !commonWords.has(word))
            .slice(0, 5); // Take top 5 keywords
    }

    buildContextMessage(userMessage, person, recentContext, ragContext, personContext) {
        let context = this.systemPrompt + '\n\n';
        
        // Add person-specific context
        context += `You are helping the user communicate with: ${person.name}\n`;
        if (person.notes) {
            context += `Context about this person: ${person.notes}\n`;
        }
        
        if (personContext && personContext.topics.length > 0) {
            context += `Common topics with this person: ${personContext.topics.map(t => t.word).join(', ')}\n`;
        }
        
        context += '\n';
        
        // Add recent conversation history
        if (recentContext.length > 0) {
            context += 'Recent conversation history with this person:\n';
            recentContext.slice(-5).forEach(turn => {
                context += `User: ${turn.user}\n`;
                if (turn.assistant) {
                    context += `You: ${turn.assistant}\n`;
                }
            });
            context += '\n';
        }
        
        // Add enhanced RAG context
        if (ragContext && ragContext.length > 0) {
            context += 'Relevant information from knowledge base:\n';
            ragContext.forEach((doc, index) => {
                const source = doc.metadata?.filename || doc.metadata?.source || 'Unknown source';
                const similarity = doc.similarity ? ` (${Math.round(doc.similarity * 100)}% relevant)` : '';
                
                // Use more content - up to 500 characters instead of 200
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

        return context;
    }

    parseResponses(text) {
        // Enhanced parsing to handle various response formats
        const lines = text.split('\n').filter(line => line.trim());
        const responses = [];
        
        lines.forEach(line => {
            // Look for numbered responses, bullet points, or quoted responses
            if (line.match(/^[1-3]\./) || line.match(/^[-*]/) || line.match(/^\d+\)/)) {
                const response = line.replace(/^[1-3]\./, '').replace(/^[-*]/, '').replace(/^\d+\)/, '').trim();
                if (response) {
                    responses.push(response);
                }
            } else if (line.startsWith('"') && line.endsWith('"') && line.length > 10) {
                // Handle quoted responses
                responses.push(line);
            }
        });
        
        // Ensure we have 3 responses
        while (responses.length < 3) {
            responses.push("I'd be happy to help you with that.");
        }
        
        return responses.slice(0, 3);
    }

    async selectResponse(conversationId, selectedResponse) {
        await dataStore.updateConversation(conversationId, { selectedResponse });
    }
}

module.exports = LLMService;