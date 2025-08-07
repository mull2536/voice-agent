const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class SimpleDataStore {
    constructor() {
        this.dataPath = path.join(__dirname, '../../data');
        this.conversationsFile = path.join(this.dataPath, 'conversations.json');
        this.settingsFile = path.join(this.dataPath, 'settings.json');
        this.peopleFile = path.join(this.dataPath, 'people.json');
        
        this.ensureDataFiles();
    }

    async ensureDataFiles() {
        // Create data directory if it doesn't exist
        try {
            await fs.mkdir(this.dataPath, { recursive: true });
            
            // Create empty files if they don't exist
            try {
                await fs.access(this.conversationsFile);
            } catch {
                await fs.writeFile(this.conversationsFile, '[]');
            }
            
            try {
                await fs.access(this.peopleFile);
            } catch {
                // Default people to get started
                const defaultPeople = [
                    { id: 'family', name: 'Family Member', notes: 'General family conversations' },
                    { id: 'caregiver', name: 'Caregiver', notes: 'Daily care and assistance' },
                    { id: 'doctor', name: 'Doctor', notes: 'Medical discussions' },
                    { id: 'friend', name: 'Friend', notes: 'Social conversations' },
                    { id: 'other', name: 'Other', notes: 'Anyone else' }
                ];
                await fs.writeFile(this.peopleFile, JSON.stringify(defaultPeople, null, 2));
            }
        } catch (error) {
            console.error('Failed to ensure data files:', error);
        }
    }

    // Conversations
    async saveConversation(conversation) {
        try {
            const conversations = await this.getConversations();
            
            const newConversation = {
                id: Date.now(),
                timestamp: new Date().toISOString(),
                personId: conversation.personId || 'other',
                personName: conversation.personName || 'Other',
                userMessage: conversation.userMessage,
                responses: conversation.responses,
                selectedResponse: conversation.selectedResponse || null,
                context: conversation.context || {}
            };
            
            conversations.push(newConversation);
            
            // Keep only last 1000 conversations in memory
            if (conversations.length > 1000) {
                conversations.shift(); // Remove oldest
            }
            
            await fs.writeFile(this.conversationsFile, JSON.stringify(conversations, null, 2));
            
            return newConversation;
        } catch (error) {
            console.error('Failed to save conversation:', error);
            throw error;
        }
    }

    async getConversations(limit = 100) {
        try {
            const data = await fs.readFile(this.conversationsFile, 'utf-8');
            const conversations = JSON.parse(data);
            
            // Return most recent conversations
            return conversations.slice(-limit).reverse();
        } catch (error) {
            console.error('Failed to get conversations:', error);
            return [];
        }
    }

    async getRecentContext(hoursBack = 24, personId = null) {
        try {
            const conversations = await this.getConversations(50);
            const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
            
            // Filter conversations within time window
            let recentConversations = conversations.filter(conv => 
                new Date(conv.timestamp) > cutoffTime
            );
            
            // Filter by person if specified
            if (personId) {
                recentConversations = recentConversations.filter(conv => 
                    conv.personId === personId
                );
            }
            
            // Format for LLM context
            return recentConversations.map(conv => ({
                person: conv.personName,
                user: conv.userMessage,
                assistant: conv.selectedResponse,
                timestamp: conv.timestamp
            }));
        } catch (error) {
            console.error('Failed to get recent context:', error);
            return [];
        }
    }

    async updateConversation(id, updates) {
        try {
            const conversations = await this.getConversations();
            const index = conversations.findIndex(c => c.id === id);
            
            if (index !== -1) {
                conversations[index] = { ...conversations[index], ...updates };
                await fs.writeFile(this.conversationsFile, JSON.stringify(conversations, null, 2));
            }
            
            return conversations[index];
        } catch (error) {
            console.error('Failed to update conversation:', error);
            throw error;
        }
    }

    // Settings
    async getSettings() {
        try {
            // Check if settings file exists
            try {
                await fs.access(this.settingsFile);
            } catch {
                // Create default settings if file doesn't exist
                const defaultSettings = {
                    llm: {
                        temperature: 0.7,
                        maxTokens: 150,
                        model: 'gpt-4.1-mini',
                        systemPrompt: '',
                        defaultLanguage: 'en'
                    },
                    tts: {
                        voiceId: process.env.ELEVENLABS_VOICE_ID || 'default',
                        speechRate: 1.0,
                        model: 'eleven_multilingual_v2',
                        outputQuality: 'mp3_44100_192',
                        stability: 0.5,
                        similarityBoost: 0.75,
                        style: 0.0,
                        useSpeakerBoost: true,
                        useFixedSeed: false,
                        fixedSeed: null
                    },
                    vad: {
                        positiveSpeechThreshold: 0.4,
                        negativeSpeechThreshold: 0.55,
                        minSpeechFrames: 8,
                        preSpeechPadFrames: 3,
                        redemptionFrames: 30
                    },
                    eyeGaze: {
                        hoverDuration: 3000,
                        visualFeedback: true
                    },
                    rag: {
                        chunkSize: 1000,
                        chunkOverlap: 200,
                        topK: 5
                    },
                    internetSearch: {
                        enabled: true,
                        maxResults: 3
                    }
                };
                await fs.writeFile(this.settingsFile, JSON.stringify(defaultSettings, null, 2));
                return defaultSettings;
            }
            
            const data = await fs.readFile(this.settingsFile, 'utf-8');
            const settings = JSON.parse(data);
            
            // Ensure all categories exist in loaded settings
            const defaultStructure = {
                llm: {},
                tts: {},
                vad: {},
                eyeGaze: {},
                rag: {},
                internetSearch: {}
            };
            
            // Merge with defaults to ensure all categories exist
            const completeSettings = {
                ...defaultStructure,
                ...settings,
                llm: { ...defaultStructure.llm, ...(settings.llm || {}) },
                tts: { ...defaultStructure.tts, ...(settings.tts || {}) },
                vad: { ...defaultStructure.vad, ...(settings.vad || {}) },
                eyeGaze: { ...defaultStructure.eyeGaze, ...(settings.eyeGaze || {}) },
                rag: { ...defaultStructure.rag, ...(settings.rag || {}) },
                internetSearch: { ...defaultStructure.internetSearch, ...(settings.internetSearch || {}) }
            };
            
            return completeSettings;
        } catch (error) {
            console.error('Failed to get settings:', error);
            // Return default structure on error
            return {
                llm: {},
                tts: {},
                vad: {},
                eyeGaze: {},
                rag: {},
                internetSearch: {}
            };
        }
    }

    // Update the updateSettings method to merge properly:
    async updateSettings(updates) {
        try {
            const currentSettings = await this.getSettings();
            
            // Deep merge the settings - handle all possible categories
            const mergedSettings = {
                ...currentSettings,
                ...updates,
                // Ensure nested objects are properly merged
                llm: {
                    ...currentSettings.llm,
                    ...(updates.llm || {})
                },
                tts: {
                    ...currentSettings.tts,
                    ...(updates.tts || {})
                },
                vad: {
                    ...currentSettings.vad,
                    ...(updates.vad || {})
                },
                eyeGaze: {
                    ...currentSettings.eyeGaze,
                    ...(updates.eyeGaze || {})
                },
                rag: {
                    ...currentSettings.rag,
                    ...(updates.rag || {})
                },
                internetSearch: {
                    ...currentSettings.internetSearch,
                    ...(updates.internetSearch || {})
                }
            };
            
            // Save to file using the existing helper method
            await fs.writeFile(this.settingsFile, JSON.stringify(mergedSettings, null, 2));
            
            logger.info('Settings updated successfully');
            return mergedSettings;
        } catch (error) {
            logger.error('Failed to update settings:', error);
            throw error;
        }
    }

    // Simple search
    async searchConversations(query) {
        try {
            const conversations = await this.getConversations(500);
            const searchTerm = query.toLowerCase();
            
            return conversations.filter(conv => 
                conv.userMessage.toLowerCase().includes(searchTerm) ||
                (conv.selectedResponse && conv.selectedResponse.toLowerCase().includes(searchTerm))
            );
        } catch (error) {
            console.error('Failed to search conversations:', error);
            return [];
        }
    }

    // People Management
    async getPeople() {
        try {
            const data = await fs.readFile(this.peopleFile, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to get people:', error);
            return [];
        }
    }

    async addPerson(person) {
        try {
            const people = await this.getPeople();
            
            const newPerson = {
                id: person.id || Date.now().toString(),
                name: person.name,
                notes: person.notes || '',
                addedAt: new Date().toISOString(),
                lastConversation: null
            };
            
            people.push(newPerson);
            await fs.writeFile(this.peopleFile, JSON.stringify(people, null, 2));
            
            return newPerson;
        } catch (error) {
            console.error('Failed to add person:', error);
            throw error;
        }
    }

    async updatePerson(id, updates) {
        try {
            const people = await this.getPeople();
            const index = people.findIndex(p => p.id === id);
            
            if (index !== -1) {
                people[index] = { ...people[index], ...updates };
                await fs.writeFile(this.peopleFile, JSON.stringify(people, null, 2));
            }
            
            return people[index];
        } catch (error) {
            console.error('Failed to update person:', error);
            throw error;
        }
    }

    async deletePerson(id) {
        try {
            const people = await this.getPeople();
            const filtered = people.filter(p => p.id !== id);
            
            await fs.writeFile(this.peopleFile, JSON.stringify(filtered, null, 2));
            
            return true;
        } catch (error) {
            console.error('Failed to delete person:', error);
            throw error;
        }
    }

    async getPersonContext(personId) {
        try {
            const people = await this.getPeople();
            const person = people.find(p => p.id === personId);
            
            if (!person) return null;
            
            // Get recent conversations with this person
            const conversations = await this.getConversations(100);
            const personConversations = conversations
                .filter(c => c.personId === personId)
                .slice(0, 10); // Last 10 conversations
            
            // Extract common topics from conversations
            const topics = this.extractTopics(personConversations);
            
            return {
                person,
                recentConversations: personConversations.slice(0, 5),
                topics,
                conversationCount: personConversations.length
            };
        } catch (error) {
            console.error('Failed to get person context:', error);
            return null;
        }
    }

    extractTopics(conversations) {
        const words = {};
        const commonWords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'what', 'where', 'when']);
        
        conversations.forEach(conv => {
            const text = `${conv.userMessage} ${conv.selectedResponse || ''}`.toLowerCase();
            text.split(/\s+/).forEach(word => {
                word = word.replace(/[^a-z]/g, '');
                if (word.length > 4 && !commonWords.has(word)) {
                    words[word] = (words[word] || 0) + 1;
                }
            });
        });
        
        return Object.entries(words)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([word, count]) => ({ word, count }));
    }

    // Export for backup
    async exportData() {
        try {
            const conversations = await this.getConversations(9999);
            const settings = await this.getSettings();
            const people = await this.getPeople();
            
            return {
                exportDate: new Date().toISOString(),
                conversations,
                settings,
                people
            };
        } catch (error) {
            console.error('Failed to export data:', error);
            throw error;
        }
    }
}

// Singleton instance
const dataStore = new SimpleDataStore();

module.exports = dataStore;