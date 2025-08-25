// client/js/audioRecorder.js - Working version without AudioWorklet complexity

class AudioRecorder {
    constructor(socket) {
        this.socket = socket;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.isRecording = false;
        this.audioChunks = [];
        this.autoRecordingEnabled = true;
        this.manualStopRequested = false;
        
        // VAD settings
        this.vadSettings = null;
        this.isSpeaking = false;
        this.silenceFrames = 0;
        this.speechFrames = 0;
        this.audioBuffer = [];
        this.preSpeechBuffer = [];
        
        // Store original console.warn for restoration
        this.originalWarn = console.warn;
        this.suppressDeprecationWarning();
        
        this.setupSocketListeners();
    }

    suppressDeprecationWarning() {
        // Override console.warn to suppress ScriptProcessorNode deprecation
        const self = this;
        console.warn = function(...args) {
            if (args[0] && typeof args[0] === 'string' && args[0].includes('ScriptProcessorNode')) {
                return; // Suppress ScriptProcessorNode deprecation warning
            }
            self.originalWarn.apply(console, args);
        };
    }
    
    restoreConsoleWarn() {
        // Restore original console.warn
        if (this.originalWarn) {
            console.warn = this.originalWarn;
        }
    }

    setupSocketListeners() {
        this.socket.on('start-client-recording', (settings) => {
            this.vadSettings = settings;
            this.startRecording();
        });

        this.socket.on('stop-client-recording', () => {
            this.stopRecording();
        });

        this.socket.on('auto-start-recording', () => {
            if (this.autoRecordingEnabled && !this.isRecording) {
                console.log('Auto-starting recording after AI speech');
                this.socket.emit('start-recording');
            }
        });
    }

    async startRecording() {
        try {
            // Reset manual stop flag
            this.manualStopRequested = false;

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
            
            // Use ScriptProcessorNode (it still works fine despite the deprecation)
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

            // Handle MediaRecorder stop event
            this.mediaRecorder.onstop = () => {
                // Send any remaining audio chunks when recording stops
                if (this.audioChunks.length > 0) {
                    this.sendPendingAudio();
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
        const energy = rms * 1000;

        // Simple VAD based on energy threshold
        const isSpeech = energy > (this.vadSettings.threshold || 0.5);

        if (isSpeech) {
            if (!this.isSpeaking) {
                this.speechFrames++;
                if (this.speechFrames >= this.vadSettings.minSpeechFrames) {
                    this.isSpeaking = true;
                    this.speechFrames = 0;
                    this.silenceFrames = 0;
                    
                    // LOG SPEECH START
                    console.log('🎤 Speech detected - started speaking');
                    
                    // Start MediaRecorder
                    if (this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
                        this.mediaRecorder.start();
                        console.log('🔴 Recording started');
                        this.socket.emit('recording-status', { status: 'recording' });
                    }
                }
            } else {
                this.silenceFrames = 0;
            }
        } else {
            if (this.isSpeaking) {
                this.silenceFrames++;
                if (this.silenceFrames >= this.vadSettings.redemptionFrames) {
                    this.isSpeaking = false;
                    this.silenceFrames = 0;
                    
                    // LOG SPEECH END
                    console.log('🔇 Speech ended - stopped speaking');
                    
                    // Stop MediaRecorder and send audio
                    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                        this.mediaRecorder.stop();
                        console.log('⏹️ Recording stopped');
                        this.socket.emit('recording-status', { status: 'listening' });
                    }
                }
            }
        }
    }

    async sendPendingAudio() {
        if (this.audioChunks.length === 0) return;

        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.audioChunks = [];

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            this.socket.emit('audio-data', { 
                audio: base64Audio,
                finalChunk: true  // Flag to indicate this is the final chunk before stop
            });
        };
        reader.readAsDataURL(audioBlob);

        // Reset buffers
        this.audioBuffer = [];
    }

    async stopRecording() {
        console.log('Stopping recording...');
        this.manualStopRequested = true;
        this.isRecording = false;

        // If we're currently speaking, stop MediaRecorder and send pending audio
        if (this.isSpeaking && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.isSpeaking = false;
            this.mediaRecorder.stop(); // This will trigger onstop event which calls sendPendingAudio
        } else if (this.audioChunks.length > 0) {
            // Send any pending chunks even if not actively speaking
            await this.sendPendingAudio();
        }

        // Clean up resources
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

    setAutoRecording(enabled) {
        this.autoRecordingEnabled = enabled;
        console.log(`Auto-recording ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    // Cleanup method to be called when recorder is no longer needed
    cleanup() {
        this.stopRecording();
        this.restoreConsoleWarn();
        
        // Clean up audio context
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

// Add to window for global access
window.AudioRecorder = AudioRecorder;