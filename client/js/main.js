// Main application controller
class CommunicationAssistant {
    constructor() {
        this.socket = null;
        this.api = null;
        this.conversationUI = null;
        this.settingsUI = null;
        this.eyeGazeControls = null;
        
        this.currentConversationId = null;
        this.isRecording = false;
        this.currentPerson = null;
        this.people = [];
        this.audioRecorder = null;
        
        this.init();
    }
    
    async init() {
        try {
            // Initialize socket connection
            this.socket = io();
            
            // Initialize modules
            this.api = new API();
            this.conversationUI = new ConversationUI();
            this.settingsUI = new SettingsUI(this.api);
            this.eyeGazeControls = new EyeGazeControls();
            this.audioRecorder = new AudioRecorder(this.socket);
            
            // Setup event listeners
            this.setupSocketListeners();
            this.setupUIListeners();
            
            // Load initial data
            await this.loadInitialData();
            
            // Start eye gaze controls
            this.eyeGazeControls.init();
            
            console.log('Communication Assistant initialized');
        } catch (error) {
            console.error('Failed to initialize:', error);
            this.showError('Failed to initialize application');
        }
    }
    
    setupSocketListeners() {
        // Connection events
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.conversationUI.setConnectionStatus(true);
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.conversationUI.setConnectionStatus(false);
        });
        
        // Person set confirmation
        this.socket.on('person-set', (data) => {
            console.log('Person set:', data.person);
            this.currentPerson = data.person;
            this.updatePersonDisplay(data.person);
        });
        
        // Recording events
        this.socket.on('recording-started', () => {
            this.isRecording = true;
            this.updateRecordingUI(true);
        });
        
        this.socket.on('recording-stopped', () => {
            this.isRecording = false;
            this.updateRecordingUI(false);
        });
        
        // Speech events
        this.socket.on('speech-detected', (data) => {
            if (data.status === 'start') {
                this.conversationUI.showSpeechIndicator();
            } else if (data.status === 'end') {
                this.conversationUI.hideSpeechIndicator();
            }
        });
        
        this.socket.on('speech-segment', async (data) => {
            console.log('Speech segment received:', data);
            // Process the audio file
            this.socket.emit('process-audio', data);
        });
        
        // Transcription and processing
        this.socket.on('transcription', (data) => {
            console.log('Transcription:', data.text);
            this.conversationUI.addMessage({
                speaker: 'You',
                content: data.text,
                type: 'user',
                person: this.currentPerson?.name || 'Unknown'
            });
        });
        
        this.socket.on('responses-generated', (data) => {
            console.log('Responses generated:', data.responses);
            this.currentConversationId = data.conversationId;
            this.displayResponseOptions(data.responses);
        });
        
        this.socket.on('tts-audio', (data) => {
            console.log('TTS audio received');
            this.playAudio(data.audio);
        });
        
        // Error handling
        this.socket.on('error', (data) => {
            console.error('Socket error:', data);
            this.showError(data.message);
        });
    }
    
    setupUIListeners() {
        // Person selector
        this.addPersonSelector();
        
        // Recording button
        const recordBtn = document.getElementById('record-btn');
        recordBtn.addEventListener('click', () => {
            this.toggleRecording();
        });
        
        // Text input
        const textInput = document.getElementById('text-input');
        const sendBtn = document.getElementById('send-text-btn');
        
        sendBtn.addEventListener('click', () => {
            this.sendTextMessage();
        });
        
        textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendTextMessage();
            }
        });
        
        // Settings button
        const settingsBtn = document.getElementById('settings-btn');
        settingsBtn.addEventListener('click', () => {
            this.settingsUI.open();
        });
    }
    
    addPersonSelector() {
        // Add person selector to header
        const headerControls = document.querySelector('.header-controls');
        const personSelector = document.createElement('div');
        personSelector.className = 'person-selector';
        personSelector.innerHTML = `
            <label for="person-select">Talking to:</label>
            <select id="person-select" class="person-select">
                <option value="">Select person...</option>
            </select>
        `;
        
        headerControls.insertBefore(personSelector, headerControls.firstChild);
        
        // Add change listener
        const select = document.getElementById('person-select');
        select.addEventListener('change', (e) => {
            const personId = e.target.value;
            if (personId) {
                this.selectPerson(personId);
            }
        });
    }
    
    async loadInitialData() {
        try {
            // Load settings
            const settingsResponse = await this.api.getSettings();
            this.settingsUI.loadSettings(settingsResponse.settings);
            
            // Load people
            const peopleResponse = await this.api.getPeople();
            this.loadPeople(peopleResponse.people);
            
            // Load recent conversations
            const conversations = await this.api.getRecentConversations(5);
            // You could display these in a sidebar or history view
            
        } catch (error) {
            console.error('Failed to load initial data:', error);
        }
    }
    
    loadPeople(people) {
        this.people = people;
        const select = document.getElementById('person-select');
        
        // Clear existing options
        select.innerHTML = '<option value="">Select person...</option>';
        
        // Add people options
        people.forEach(person => {
            const option = document.createElement('option');
            option.value = person.id;
            option.textContent = person.name;
            select.appendChild(option);
        });
        
        // Also update settings UI
        if (this.settingsUI) {
            this.settingsUI.loadPeople(people);
        }
    }
    
    selectPerson(personId) {
        const person = this.people.find(p => p.id === personId);
        if (person) {
            this.currentPerson = person;
            this.socket.emit('set-person', personId);
            
            // Update UI
            this.updatePersonDisplay(person);
            
            // Show welcome message for this person
            this.conversationUI.showNotification(`Now talking to ${person.name}`, 'info');
        }
    }
    
    updatePersonDisplay(person) {
        const indicator = document.getElementById('current-speaker');
        indicator.textContent = `Talking to: ${person.name}`;
        
        // Update dropdown if needed
        const select = document.getElementById('person-select');
        if (select.value !== person.id) {
            select.value = person.id;
        }
    }
    
    toggleRecording() {
        if (!this.currentPerson) {
            this.showError('Please select who you\'re talking to first');
            return;
        }
        
        if (this.isRecording) {
            this.socket.emit('stop-recording');
        } else {
            this.socket.emit('start-recording');
        }
    }
    
    updateRecordingUI(isRecording) {
        const recordBtn = document.getElementById('record-btn');
        const recordingIndicator = document.getElementById('recording-indicator');
        
        if (isRecording) {
            recordBtn.classList.add('recording');
            recordBtn.querySelector('span').textContent = 'Stop Recording';
            recordingIndicator.classList.add('active');
        } else {
            recordBtn.classList.remove('recording');
            recordBtn.querySelector('span').textContent = 'Start Recording';
            recordingIndicator.classList.remove('active');
        }
    }
    
    sendTextMessage() {
        if (!this.currentPerson) {
            this.showError('Please select who you\'re talking to first');
            return;
        }
        
        const textInput = document.getElementById('text-input');
        const text = textInput.value.trim();
        
        if (!text) return;
        
        // Add message to UI
        this.conversationUI.addMessage({
            speaker: 'You',
            content: text,
            type: 'user',
            person: this.currentPerson.name
        });
        
        // Send to server
        this.socket.emit('text-input', {
            text: text
        });
        
        // Clear input
        textInput.value = '';
        textInput.focus();
    }
    
    displayResponseOptions(responses) {
        const responseSelection = document.getElementById('response-selection');
        const responseOptions = document.getElementById('response-options');
        
        // Clear existing options
        responseOptions.innerHTML = '';
        
        // Create response buttons
        responses.forEach((response, index) => {
            const option = document.createElement('div');
            option.className = 'response-option';
            option.dataset.responseIndex = index;
            option.textContent = response;
            
            // Add click listener
            option.addEventListener('click', () => {
                this.selectResponse(response);
            });
            
            // Add to eye gaze targets
            this.eyeGazeControls.addTarget(option, () => {
                this.selectResponse(response);
            });
            
            responseOptions.appendChild(option);
        });
        
        // Show response selection
        responseSelection.classList.add('active');
    }
    
    selectResponse(responseText) {
        // Hide response selection
        const responseSelection = document.getElementById('response-selection');
        responseSelection.classList.remove('active');
        
        // Add to conversation
        this.conversationUI.addMessage({
            speaker: 'You (via AI)',
            content: responseText,
            type: 'assistant',
            person: this.currentPerson?.name || 'Unknown'
        });
        
        // Send to server for TTS and storage
        this.socket.emit('select-response', {
            responseText: responseText,
            conversationId: this.currentConversationId
        });
        
        // Clear eye gaze targets
        this.eyeGazeControls.clearTargets();
    }
    
    playAudio(audioBase64) {
        try {
            const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
            audio.play();
        } catch (error) {
            console.error('Failed to play audio:', error);
        }
    }
    
    showError(message) {
        this.conversationUI.showNotification(message, 'error');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new CommunicationAssistant();
});