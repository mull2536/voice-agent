const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class SimpleDataStore {
    constructor() {
        this.dataPath = path.join(__dirname, '../../data');
        this.settingsFile = path.join(this.dataPath, 'settings.json');
        this.peopleFile = path.join(this.dataPath, 'people.json');
        
        this.ensureDataFiles();
    }

    async ensureDataFiles() {
        // Create data directory if it doesn't exist
        try {
            await fs.mkdir(this.dataPath, { recursive: true });
        
            
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
            
            // Migration: Remove old transcription.language if it exists
            if (settings.transcription && settings.transcription.language !== undefined) {
                delete settings.transcription.language;
                // If transcription object is now empty, remove it
                if (Object.keys(settings.transcription).length === 0) {
                    delete settings.transcription;
                }
                // Save the cleaned settings
                await fs.writeFile(this.settingsFile, JSON.stringify(settings, null, 2));
            }
            
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
            
            // Remove old transcription.language if it exists (migrating to recorder.transcriptionLanguage)
            if (newSettings.transcription && newSettings.transcription.language !== undefined) {
                delete newSettings.transcription.language;
                // If transcription object is now empty, remove it
                if (Object.keys(newSettings.transcription).length === 0) {
                    delete newSettings.transcription;
                }
            }
            
            // Save to file
            await fs.writeFile(this.settingsFile, JSON.stringify(newSettings, null, 2));
            
            logger.info('Settings updated in dataStore');
            
            return newSettings;
        } catch (error) {
            console.error('Failed to update settings:', error);
            throw error;
        }
    }

    // Dummy implementations for routes that expect these methods
    async getRecentContext(hoursBack = 24, personId = null) {
        // TODO: Implement reading from chat history instead
        logger.warn('getRecentContext called but not implemented - returning empty context');
        return '';
    }

    async searchConversations(query) {
        // TODO: Implement searching through chat history instead
        logger.warn('searchConversations called but not implemented - returning empty results');
        return [];
    }

    async getPersonContext(personId) {
        // TODO: Implement getting person context from chat history
        logger.warn('getPersonContext called but not implemented - returning null');
        return null;
    }

    async exportData() {
        // Export all data for backup
        try {
            const settings = await this.getSettings();
            const people = await this.getPeople();
            // Don't include conversations since we're moving away from it

            return {
                exportDate: new Date().toISOString(),
                settings,
                people,
                conversations: [] // Empty for now
            };
        } catch (error) {
            logger.error('Failed to export data:', error);
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