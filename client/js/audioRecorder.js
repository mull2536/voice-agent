class AudioRecorder {
    constructor(socket) {
        this.socket = socket;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.isRecording = false;
        this.audioChunks = [];
        
        // VAD settings
        this.vadSettings = null;
        this.isSpeaking = false;
        this.silenceFrames = 0;
        this.speechFrames = 0;
        this.audioBuffer = [];
        this.preSpeechBuffer = [];
        
        this.setupSocketListeners();
    }

    setupSocketListeners() {
        this.socket.on('start-client-recording', (settings) => {
            this.vadSettings = settings;
            this.startRecording();
        });

        this.socket.on('stop-client-recording', () => {
            this.stopRecording();
        });
    }

    async startRecording() {
        try {
            // Get microphone access with noise reduction
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000
                }
            });

            // Setup audio context for VAD
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });
            
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            
            const scriptProcessor = this.audioContext.createScriptProcessor(
                this.vadSettings.frameSamples,
                1,
                1
            );

            // Connect nodes
            this.microphone.connect(this.analyser);
            this.analyser.connect(scriptProcessor);
            scriptProcessor.connect(this.audioContext.destination);

            // Setup MediaRecorder for saving audio
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm'
            });

            this.audioChunks = [];
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            // Process audio for VAD
            scriptProcessor.onaudioprocess = (event) => {
                if (!this.isRecording) return;
                
                const inputData = event.inputBuffer.getChannelData(0);
                this.processVAD(inputData);
            };

            // Start recording
            this.isRecording = true;
            this.socket.emit('recording-status', { status: 'listening' });
            
            console.log('Audio recording started with VAD');

        } catch (error) {
            console.error('Failed to start recording:', error);
            this.socket.emit('recording-error', { error: error.message });
        }
    }

    processVAD(audioData) {
        // Calculate RMS energy
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);
        
        // Simple energy-based VAD (you can enhance this with the actual Silero model)
        const energy = rms * 100;
        
        // Add to pre-speech buffer
        this.preSpeechBuffer.push(audioData.slice());
        if (this.preSpeechBuffer.length > this.vadSettings.preSpeechPadFrames) {
            this.preSpeechBuffer.shift();
        }

        if (energy > this.vadSettings.positiveSpeechThreshold) {
            // Speech detected
            if (!this.isSpeaking) {
                this.speechFrames++;
                
                if (this.speechFrames >= this.vadSettings.minSpeechFrames) {
                    // Start of speech
                    this.isSpeaking = true;
                    this.silenceFrames = 0;
                    
                    // Add pre-speech buffer
                    this.audioBuffer = [...this.preSpeechBuffer.flat()];
                    
                    // Start MediaRecorder
                    if (this.mediaRecorder.state === 'inactive') {
                        this.mediaRecorder.start();
                        this.socket.emit('speech-detected', { status: 'start' });
                        console.log('Speech started');
                    }
                }
            } else {
                // Continue recording
                this.audioBuffer.push(...audioData);
                this.silenceFrames = 0;
            }
        } else if (energy < this.vadSettings.negativeSpeechThreshold) {
            // Silence detected
            if (this.isSpeaking) {
                this.silenceFrames++;
                this.audioBuffer.push(...audioData);
                
                if (this.silenceFrames >= this.vadSettings.redemptionFrames) {
                    // End of speech
                    this.isSpeaking = false;
                    this.speechFrames = 0;
                    
                    // Stop MediaRecorder and send audio
                    if (this.mediaRecorder.state === 'recording') {
                        this.mediaRecorder.stop();
                        this.socket.emit('speech-detected', { status: 'end' });
                        console.log('Speech ended');
                        
                        // Send audio after a short delay
                        setTimeout(() => {
                            this.sendAudio();
                        }, 100);
                    }
                }
            } else {
                this.speechFrames = 0;
            }
        }
    }

    async sendAudio() {
        if (this.audioChunks.length === 0) return;

        // Combine audio chunks
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.audioChunks = [];

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            this.socket.emit('audio-data', { audio: base64Audio });
        };
        reader.readAsDataURL(audioBlob);

        // Reset for next recording
        this.audioBuffer = [];
        
        // Restart MediaRecorder for continuous recording
        if (this.isRecording && this.mediaRecorder.state === 'inactive') {
            setTimeout(() => {
                if (this.isRecording) {
                    this.mediaRecorder.start();
                }
            }, 500);
        }
    }

    async stopRecording() {
        this.isRecording = false;

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        if (this.microphone) {
            this.microphone.disconnect();
        }

        if (this.audioContext) {
            this.audioContext.close();
        }

        // Stop all tracks
        if (this.mediaRecorder && this.mediaRecorder.stream) {
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }

        this.socket.emit('recording-status', { status: 'stopped' });
        console.log('Audio recording stopped');
    }
}

// Add to window for global access
window.AudioRecorder = AudioRecorder;