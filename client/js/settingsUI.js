// Settings UI management
class SettingsUI {
    constructor(api) {
        this.api = api;
        this.modal = document.getElementById('settings-modal');
        this.settings = {};
        this.people = [];
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Close button
        document.getElementById('close-settings').addEventListener('click', () => {
            this.close();
        });
        
        // Save button
        document.getElementById('save-settings').addEventListener('click', () => {
            this.saveSettings();
        });
        
        // Add person button
        document.getElementById('add-speaker-btn').addEventListener('click', () => {
            this.showAddPersonDialog();
        });
        
        // Range inputs - show value
        const rangeInputs = this.modal.querySelectorAll('input[type="range"]');
        rangeInputs.forEach(input => {
            input.addEventListener('input', (e) => {
                const valueDisplay = e.target.parentElement.querySelector('.value-display');
                if (valueDisplay) {
                    const value = e.target.value;
                    if (e.target.id === 'hover-duration') {
                        valueDisplay.textContent = `${value}s`;
                    } else if (e.target.id === 'speech-rate') {
                        valueDisplay.textContent = `${value}x`;
                    } else {
                        valueDisplay.textContent = value;
                    }
                }
            });
        });
    }
    
    async open() {
        this.modal.classList.add('active');
        
        // Load latest settings
        try {
            const response = await this.api.getSettings();
            this.loadSettings(response.settings);
            
            // Load voices
            const voicesResponse = await this.api.getVoices();
            this.loadVoices(voicesResponse.voices);
            
            // Load people
            const peopleResponse = await this.api.getPeople();
            this.loadPeople(peopleResponse.people);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }
    
    close() {
        this.modal.classList.remove('active');
    }
    
    loadSettings(settings) {
        this.settings = settings;
        
        // TTS Settings
        if (settings.tts) {
            const speechRate = document.getElementById('speech-rate');
            if (speechRate && settings.tts.speechRate) {
                speechRate.value = settings.tts.speechRate;
                speechRate.dispatchEvent(new Event('input'));
            }
        }
        
        // Eye Gaze Settings
        if (settings.eyeGaze) {
            const hoverDuration = document.getElementById('hover-duration');
            const visualFeedback = document.getElementById('visual-feedback');
            
            if (hoverDuration && settings.eyeGaze.hoverDuration) {
                hoverDuration.value = settings.eyeGaze.hoverDuration / 1000;
                hoverDuration.dispatchEvent(new Event('input'));
            }
            
            if (visualFeedback) {
                visualFeedback.checked = settings.eyeGaze.visualFeedback !== false;
            }
        }
        
        // LLM Settings
        if (settings.llm) {
            const temperature = document.getElementById('temperature');
            const maxTokens = document.getElementById('max-tokens');
            
            if (temperature && settings.llm.temperature !== undefined) {
                temperature.value = settings.llm.temperature;
                temperature.dispatchEvent(new Event('input'));
            }
            
            if (maxTokens && settings.llm.maxTokens) {
                maxTokens.value = settings.llm.maxTokens;
            }
        }
    }
    
    loadVoices(voices) {
        const voiceSelect = document.getElementById('voice-select');
        voiceSelect.innerHTML = '';
        
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.voice_id;
            option.textContent = voice.name;
            
            if (this.settings.tts && this.settings.tts.voiceId === voice.voice_id) {
                option.selected = true;
            }
            
            voiceSelect.appendChild(option);
        });
    }
    
    loadPeople(people) {
        this.people = people;
        const peopleList = document.getElementById('speaker-list');
        peopleList.innerHTML = '';
        
        people.forEach(person => {
            const personItem = this.createPersonItem(person);
            peopleList.appendChild(personItem);
        });
    }
    
    createPersonItem(person) {
        const item = document.createElement('div');
        item.className = 'speaker-item';
        
        const lastConv = person.lastConversation 
            ? new Date(person.lastConversation).toLocaleDateString() 
            : 'Never';
        
        item.innerHTML = `
            <div class="speaker-info">
                <div class="speaker-name">${person.name}</div>
                <div class="speaker-notes">${person.notes || 'No notes'}</div>
                <div class="speaker-last">Last conversation: ${lastConv}</div>
            </div>
            <div class="speaker-actions">
                <button onclick="app.settingsUI.editPerson('${person.id}')">Edit</button>
                <button onclick="app.settingsUI.deletePerson('${person.id}')">Delete</button>
            </div>
        `;
        
        return item;
    }
    
    async saveSettings() {
        try {
            const updates = {};
            
            // Collect all settings
            const voiceSelect = document.getElementById('voice-select');
            const speechRate = document.getElementById('speech-rate');
            const hoverDuration = document.getElementById('hover-duration');
            const visualFeedback = document.getElementById('visual-feedback');
            const temperature = document.getElementById('temperature');
            const maxTokens = document.getElementById('max-tokens');
            
            updates.tts = {
                voiceId: voiceSelect.value,
                speechRate: parseFloat(speechRate.value)
            };
            
            updates.eyeGaze = {
                hoverDuration: parseFloat(hoverDuration.value) * 1000,
                visualFeedback: visualFeedback.checked
            };
            
            updates.llm = {
                temperature: parseFloat(temperature.value),
                maxTokens: parseInt(maxTokens.value)
            };
            
            // Save to server
            await this.api.updateSettings(updates);
            
            // Update local eye gaze settings
            if (window.app && window.app.eyeGazeControls) {
                window.app.eyeGazeControls.updateSettings({
                    hoverDuration: parseFloat(hoverDuration.value),
                    visualFeedback: visualFeedback.checked
                });
            }
            
            this.showNotification('Settings saved successfully!', 'success');
            this.close();
            
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showNotification('Failed to save settings', 'error');
        }
    }
    
    showAddPersonDialog() {
        const name = prompt('Enter person\'s name:');
        if (!name) return;
        
        const notes = prompt('Enter notes about this person (optional):\nExample: "My wife, likes to hear about my day"');
        
        this.addPerson(name, notes || '');
    }
    
    async addPerson(name, notes) {
        try {
            const response = await this.api.addPerson(name, notes);
            
            if (response.success) {
                // Reload people
                const peopleResponse = await this.api.getPeople();
                this.loadPeople(peopleResponse.people);
                
                this.showNotification(`Added "${name}" successfully!`, 'success');
            }
        } catch (error) {
            console.error('Failed to add person:', error);
            this.showNotification('Failed to add person', 'error');
        }
    }
    
    async editPerson(id) {
        const person = this.people.find(p => p.id === id);
        if (!person) return;
        
        const name = prompt('Edit name:', person.name);
        if (!name) return;
        
        const notes = prompt('Edit notes:', person.notes || '');
        
        try {
            await this.api.updatePerson(id, { name, notes });
            
            // Reload people
            const peopleResponse = await this.api.getPeople();
            this.loadPeople(peopleResponse.people);
            
            this.showNotification('Person updated successfully!', 'success');
        } catch (error) {
            console.error('Failed to update person:', error);
            this.showNotification('Failed to update person', 'error');
        }
    }
    
    async deletePerson(id) {
        const person = this.people.find(p => p.id === id);
        if (!person) return;
        
        // Don't allow deleting default people
        if (['family', 'caregiver', 'doctor', 'friend', 'other'].includes(id)) {
            this.showNotification('Cannot delete default people', 'error');
            return;
        }
        
        if (!confirm(`Delete "${person.name}"?`)) return;
        
        try {
            await this.api.deletePerson(id);
            
            // Reload people
            const peopleResponse = await this.api.getPeople();
            this.loadPeople(peopleResponse.people);
            
            this.showNotification('Person deleted successfully!', 'success');
        } catch (error) {
            console.error('Failed to delete person:', error);
            this.showNotification('Failed to delete person', 'error');
        }
    }
    
    showNotification(message, type = 'info') {
        // Use the conversation UI notification system
        if (window.app && window.app.conversationUI) {
            window.app.conversationUI.showNotification(message, type);
        }
    }
}