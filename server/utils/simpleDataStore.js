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
                    { id: 'family', name: 'Family Member', notes: 'General family conversations', addedAt: new Date().toISOString() },
                    { id: 'caregiver', name: 'Caregiver', notes: 'Daily care and assistance', addedAt: new Date().toISOString() },
                    { id: 'doctor', name: 'Doctor', notes: 'Medical discussions', addedAt: new Date().toISOString() },
                    { id: 'friend', name: 'Friend', notes: 'Social conversations', addedAt: new Date().toISOString() },
                    { id: 'other', name: 'Other', notes: 'Anyone else', addedAt: new Date().toISOString() }
                ];
                await fs.writeFile(this.peopleFile, JSON.stringify(defaultPeople, null, 2));
            }
        } catch (error) {
            console.error('Failed to ensure data files:', error);
        }
    }

    // Helper method to check if file exists
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
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
                responses: conversation.responses || [],
                selectedResponse: conversation.selectedResponse || null
            };
            
            conversations.push(newConversation);
            
            // Keep only last 100 conversations
            if (conversations.length > 100) {
                conversations.splice(0, conversations.length - 100);
            }
            
            await fs.writeFile(this.conversationsFile, JSON.stringify(conversations, null, 2));
            
            return newConversation;
        } catch (error) {
            console.error('Failed to save conversation:', error);
            throw error;
        }
    }

    async getConversations() {
        try {
            const data = await fs.readFile(this.conversationsFile, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to get conversations:', error);
            return [];
        }
    }

    async addConversation(conversation) {
        try {
            const conversations = await this.getConversations();
            conversations.push(conversation);
            
            // Keep only last 100 conversations
            if (conversations.length > 100) {
                conversations.splice(0, conversations.length - 100);
            }
            
            await fs.writeFile(this.conversationsFile, JSON.stringify(conversations, null, 2));
            return conversation;
        } catch (error) {
            console.error('Failed to add conversation:', error);
            throw error;
        }
    }

    async updateConversation(conversationId, updates) {
        try {
            const conversations = await this.getConversations();
            const index = conversations.findIndex(c => c.id === conversationId);
            
            if (index === -1) {
                throw new Error('Conversation not found');
            }
            
            conversations[index] = { ...conversations[index], ...updates };
            await fs.writeFile(this.conversationsFile, JSON.stringify(conversations, null, 2));
            
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
            const exists = await this.fileExists(this.settingsFile);
            if (!exists) {
                // Create default settings
                const defaultSettings = {
                    llm: {
                        model: 'gpt-4.1-mini',
                        temperature: 0.7,
                        maxTokens: 150,
                        systemPrompt: ''  // Empty means use default
                    },
                    tts: {
                        voiceId: 'JBFqnCBsd6RMkjVDRZzb',  // Default voice ID as requested
                        speechRate: 1.0,
                        stability: 0.5,
                        similarityBoost: 0.75,
                        style: 0.0,
                        useSpeakerBoost: true,
                        seed: null,
                        fixedSeed: false
                    },
                    transcription: {
                        language: 'en'
                    },
                    vad: {
                        positiveSpeechThreshold: 0.4,
                        negativeSpeechThreshold: 0.55,
                        minSpeechFrames: 8,
                        preSpeechPadFrames: 3,
                        redemptionFrames: 30,
                        threshold: 0.5,
                        minSpeechDuration: 250,
                        maxSpeechDuration: 10000
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
                    },
                    system: {
                        defaultLanguage: 'en'  // en, nl, es
                    }
                };
                await fs.writeFile(this.settingsFile, JSON.stringify(defaultSettings, null, 2));
                return defaultSettings;
            }
            
            const data = await fs.readFile(this.settingsFile, 'utf-8');
            const settings = JSON.parse(data);
            
            // Ensure all categories exist in loaded settings with proper defaults
            const defaultStructure = {
                llm: {
                    model: 'gpt-4.1-mini',
                    temperature: 0.7,
                    maxTokens: 150,
                    systemPrompt: ''
                },
                tts: {
                    voiceId: 'JBFqnCBsd6RMkjVDRZzb',
                    speechRate: 1.0,
                    stability: 0.5,
                    similarityBoost: 0.75,
                    style: 0.0,
                    useSpeakerBoost: true,
                    seed: null,
                    fixedSeed: false
                },
                transcription: {
                    language: 'en'
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
                },
                system: {
                    defaultLanguage: 'en'
                }
            };
            
            // Deep merge function
            const deepMerge = (target, source) => {
                const output = Object.assign({}, target);
                if (isObject(target) && isObject(source)) {
                    Object.keys(source).forEach(key => {
                        if (isObject(source[key])) {
                            if (!(key in target))
                                Object.assign(output, { [key]: source[key] });
                            else
                                output[key] = deepMerge(target[key], source[key]);
                        } else {
                            Object.assign(output, { [key]: source[key] });
                        }
                    });
                }
                return output;
            };
            
            const isObject = (item) => {
                return item && typeof item === 'object' && !Array.isArray(item);
            };
            
            // Merge with defaults to ensure all properties exist
            const completeSettings = deepMerge(defaultStructure, settings);
            
            return completeSettings;
        } catch (error) {
            console.error('Failed to get settings:', error);
            // Return default structure on error
            return {
                llm: {
                    model: 'gpt-4.1-mini',
                    temperature: 0.7,
                    maxTokens: 150,
                    systemPrompt: ''
                },
                tts: {
                    voiceId: 'JBFqnCBsd6RMkjVDRZzb',
                    speechRate: 1.0,
                    stability: 0.5,
                    similarityBoost: 0.75,
                    style: 0.0,
                    useSpeakerBoost: true,
                    seed: null,
                    fixedSeed: false
                },
                transcription: {
                    language: 'en'
                },
                vad: {},
                eyeGaze: {},
                rag: {},
                internetSearch: {},
                system: {
                    defaultLanguage: 'en'
                }
            };
        }
    }

    async updateSettings(updates) {
        try {
            // Get current settings
            const currentSettings = await this.getSettings();
            
            // Deep merge function
            const deepMerge = (target, source) => {
                const output = Object.assign({}, target);
                if (isObject(target) && isObject(source)) {
                    Object.keys(source).forEach(key => {
                        if (isObject(source[key])) {
                            if (!(key in target))
                                Object.assign(output, { [key]: source[key] });
                            else
                                output[key] = deepMerge(target[key], source[key]);
                        } else {
                            Object.assign(output, { [key]: source[key] });
                        }
                    });
                }
                return output;
            };
            
            const isObject = (item) => {
                return item && typeof item === 'object' && !Array.isArray(item);
            };
            
            // Merge updates with current settings
            const newSettings = deepMerge(currentSettings, updates);
            
            // Save to file
            await fs.writeFile(this.settingsFile, JSON.stringify(newSettings, null, 2));
            
            logger.info('Settings updated in dataStore');
            
            return newSettings;
        } catch (error) {
            console.error('Failed to update settings:', error);
            throw error;
        }
    }

    // People
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
                id: Date.now().toString(),
                name: person.name,
                notes: person.notes || '',
                addedAt: new Date().toISOString()
            };
            
            people.push(newPerson);
            await fs.writeFile(this.peopleFile, JSON.stringify(people, null, 2));
            
            return newPerson;
        } catch (error) {
            console.error('Failed to add person:', error);
            throw error;
        }
    }

    async updatePerson(personId, updates) {
        try {
            const people = await this.getPeople();
            const index = people.findIndex(p => p.id === personId);
            
            if (index === -1) {
                throw new Error('Person not found');
            }
            
            people[index] = { ...people[index], ...updates };
            await fs.writeFile(this.peopleFile, JSON.stringify(people, null, 2));
            
            return people[index];
        } catch (error) {
            console.error('Failed to update person:', error);
            throw error;
        }
    }

    async deletePerson(personId) {
        try {
            const people = await this.getPeople();
            const filteredPeople = people.filter(p => p.id !== personId);
            
            if (filteredPeople.length === people.length) {
                throw new Error('Person not found');
            }
            
            await fs.writeFile(this.peopleFile, JSON.stringify(filteredPeople, null, 2));
            
            return true;
        } catch (error) {
            console.error('Failed to delete person:', error);
            throw error;
        }
    }

    async findPersonById(personId) {
        try {
            const people = await this.getPeople();
            return people.find(p => p.id === personId) || null;
        } catch (error) {
            console.error('Failed to find person:', error);
            return null;
        }
    }
}

// Export singleton instance
module.exports = new SimpleDataStore();