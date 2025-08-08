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
            
            // Load initial data and settings FIRST
            await this.loadInitialData();
            
            // THEN start eye gaze controls with correct settings
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
        
        // Person selection events
        this.socket.on('person-set', (data) => {
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
            this.playAudio(data.audio, () => {
                // Auto-start recording after response audio finishes
                this.autoStartRecordingAfterDelay();
            });
        });
        
        // Speak text events
        this.socket.on('speak-audio', (data) => {
            console.log('Speak audio received');
            this.playAudio(data.audio, () => {
                // Auto-start recording after speak audio finishes
                this.autoStartRecordingAfterDelay();
            });
        });
        
        this.socket.on('speak-error', (data) => {
            console.error('Speak error:', data);
            this.showError('Failed to synthesize speech: ' + data.message);
            
            // Re-enable speak button
            const speakBtn = document.getElementById('speak-text-btn');
            speakBtn.disabled = false;
        });
        
        // Error handling
        this.socket.on('error', (data) => {
            console.error('Socket error:', data);
            this.showError(data.message);
        });
    }

    setupUIListeners() {
        
        // Recording button
        const recordBtn = document.getElementById('record-btn');
        recordBtn.addEventListener('click', () => {
            this.toggleRecording();
        });
        
        // Text input
        const textInput = document.getElementById('text-input');
        const sendBtn = document.getElementById('send-text-btn');
        const speakBtn = document.getElementById('speak-text-btn');
        
        sendBtn.addEventListener('click', () => {
            this.sendTextMessage();
        });
        
        speakBtn.addEventListener('click', () => {
            this.speakTextMessage();
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
    
    async loadInitialData() {
        try {
            // Load settings first
            const settingsResponse = await this.api.getSettings();
            this.settingsUI.loadSettings(settingsResponse.settings);
            
            // Apply eye gaze settings to the controls - FIXED
            if (settingsResponse.settings.eyeGaze) {
                const serverDuration = settingsResponse.settings.eyeGaze.hoverDuration; // Should be 3000ms
                const durationInSeconds = serverDuration / 1000; // Convert to 3 seconds
                
                this.eyeGazeControls.updateSettings({
                    hoverDuration: durationInSeconds, // Pass 3 seconds, will become 3000ms internally
                    visualFeedback: settingsResponse.settings.eyeGaze.visualFeedback
                });
                
                console.log('Eye gaze settings applied:', {
                    serverDurationMs: serverDuration,
                    passedSeconds: durationInSeconds,
                    finalDurationMs: this.eyeGazeControls.hoverDuration,
                    visualFeedback: this.eyeGazeControls.visualFeedback
                });
            } else {
                // Ensure default 3-second duration
                this.eyeGazeControls.updateSettings({
                    hoverDuration: 3, // 3 seconds (will be converted to 3000ms internally)
                    visualFeedback: true
                });
            }
            
            // ADD THIS: Load people
            try {
                const peopleResponse = await this.api.getPeople();
                this.people = peopleResponse.people || peopleResponse || [];
            } catch (err) {
                console.error('Failed to load people:', err);
                this.people = [];
            }
            
            // ADD THIS: Check for saved person
            const savedPersonId = localStorage.getItem('selectedPersonId');
            if (savedPersonId && this.people && this.people.length > 0) {
                const savedPerson = this.people.find(p => p.id === savedPersonId);
                if (savedPerson) {
                    this.currentPerson = savedPerson;
                    this.socket.emit('set-person', savedPersonId);
                    this.updatePersonDisplay(savedPerson);
                    console.log('Restored selected person:', savedPerson.name);
                } else {
                    this.currentPerson = null;
                }
            } else {
                this.currentPerson = null;
            }
            
            // Load recent conversations
            const conversations = await this.api.getRecentConversations(5);
            // You could display these in a sidebar or history view
            
        } catch (error) {
            console.error('Failed to load initial data:', error);
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
        if (indicator) {
            indicator.textContent = `Talking to: ${person.name}`;
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

    autoStartRecordingAfterDelay() {
        // Start recording automatically after AI speaks, with a short delay
        setTimeout(() => {
            if (!this.isRecording && this.currentPerson) {
                console.log('Auto-starting recording after AI speech');
                this.socket.emit('start-recording');
            }
        }, 800); // 800ms delay to avoid capturing audio tail
    }
    
    sendTextMessage() {
        if (!this.currentPerson) {
            this.showError('Please select who you\'re talking to first');
            return;
        }
        
        const textInput = document.getElementById('text-input');
        const text = textInput.value.trim();
        
        if (!text) return;
        
        // Add message to UI as user message
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

    speakTextMessage() {
        if (!this.currentPerson) {
            this.showError('Please select who you\'re talking to first');
            return;
        }
        
        const textInput = document.getElementById('text-input');
        const speakBtn = document.getElementById('speak-text-btn');
        const text = textInput.value.trim();
        
        if (!text) return;
        
        // Disable button during processing
        speakBtn.disabled = true;
        
        // Add message to UI as assistant message - CONSISTENT WITH selectResponse
        this.conversationUI.addMessage({
            speaker: 'You (via AI)',
            content: text,
            type: 'assistant',
            person: this.currentPerson?.name || 'Unknown'
        });
        
        // Send to server for TTS
        this.socket.emit('speak-text', {
            text: text,
            personId: this.currentPerson.id
        });
        
        // Clear input
        textInput.value = '';
        textInput.focus();
        
        // Re-enable button after a short delay
        setTimeout(() => {
            speakBtn.disabled = false;
        }, 1000);
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
            option.textContent = response;
            option.dataset.responseIndex = index;
            
            // Add click handler
            option.addEventListener('click', () => {
                this.selectResponse(response);
            });
            
            // CRITICAL: Add to eye gaze targets for hover selection with visual feedback
            this.eyeGazeControls.addTarget(option, () => {
                this.selectResponse(response);
            });
            
            responseOptions.appendChild(option);
        });
        
        // Show response selection
        responseSelection.classList.add('active');
    }
    
    selectResponse(responseText) {
        // Add response to conversation as assistant
        this.conversationUI.addMessage({
            speaker: 'You (via AI)',
            content: responseText,
            type: 'assistant',
            person: this.currentPerson?.name || 'Unknown'
        });
        
        // Hide response options
        const responseSelection = document.getElementById('response-selection');
        responseSelection.classList.remove('active');
        
        // CRITICAL: Clear eye gaze targets when hiding options
        this.eyeGazeControls.clearTargets();
        
        // Send selection to server
        this.socket.emit('select-response', {
            responseText: responseText,
            conversationId: this.currentConversationId
        });
    }
    
    playAudio(base64Audio, onComplete = null) {
        try {
            // Convert base64 to blob
            const audioData = atob(base64Audio);
            const arrayBuffer = new ArrayBuffer(audioData.length);
            const view = new Uint8Array(arrayBuffer);
            
            for (let i = 0; i < audioData.length; i++) {
                view[i] = audioData.charCodeAt(i);
            }
            
            const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
            const audioUrl = URL.createObjectURL(blob);
            
            const audio = new Audio(audioUrl);
            
            // Add event listeners
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                console.log('Audio playback completed');
                
                // Call completion callback if provided
                if (onComplete && typeof onComplete === 'function') {
                    onComplete();
                }
            };
            
            audio.onerror = (error) => {
                console.error('Audio playback failed:', error);
                URL.revokeObjectURL(audioUrl);
                this.showError('Failed to play audio');
                
                // Still call completion callback even on error
                if (onComplete && typeof onComplete === 'function') {
                    onComplete();
                }
            };
            
            // Play the audio
            audio.play().catch(error => {
                console.error('Failed to start audio playback:', error);
                URL.revokeObjectURL(audioUrl);
                this.showError('Failed to play audio');
            });
            
        } catch (error) {
            console.error('Failed to process audio:', error);
            this.showError('Failed to process audio');
            
            // Call completion callback even on error
            if (onComplete && typeof onComplete === 'function') {
                onComplete();
            }
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