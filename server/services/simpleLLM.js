const { OpenAI } = require('openai');
const dataStore = require('../utils/simpleDataStore');
const { getRAGContext } = require('./rag');

class SimpleLLMService {
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
            
            // Get RAG context if available
            const ragContext = await getRAGContext(userMessage);
            
            // Build context message
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
            
            if (ragContext && ragContext.length > 0) {
                context += 'Relevant information from knowledge base:\n';
                ragContext.slice(0, 3).forEach(doc => {
                    context += `- ${doc.content.substring(0, 200)}...\n`;
                });
                context += '\n';
            }
            
            context += `Current message: ${userMessage}\n`;
            context += `Generate 3 different response options appropriate for talking to ${person.name}.`;
            context += ` Consider the relationship and previous topics of conversation.`;

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
            
            // Save the conversation
            const conversation = await dataStore.saveConversation({
                personId,
                personName: person.name,
                userMessage,
                responses,
                context: { ragUsed: ragContext.length > 0 }
            });
            
            // Update person's last conversation time
            await dataStore.updatePerson(personId, {
                lastConversation: new Date().toISOString()
            });
            
            return {
                conversationId: conversation.id,
                responses
            };
            
        } catch (error) {
            console.error('Failed to generate responses:', error);
            
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

    parseResponses(text) {
        // Simple parsing - in production you might want more robust parsing
        const lines = text.split('\n').filter(line => line.trim());
        const responses = [];
        
        lines.forEach(line => {
            // Look for numbered responses or bullet points
            if (line.match(/^[1-3]\./) || line.match(/^-/) || line.match(/^\*/)) {
                const response = line.replace(/^[1-3]\./, '').replace(/^[-*]/, '').trim();
                if (response) {
                    responses.push(response);
                }
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

module.exports = SimpleLLMService;