// client/js/audioRecorder.js - Modernized version with AudioWorkletNode

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
      this.vadProcessor = null;
      
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
          
          // For modern browsers, use AudioWorkletNode if available
          if (this.audioContext.audioWorklet && typeof this.audioContext.audioWorklet.addModule === 'function') {
              try {
                  // Create the VAD processor module
                  await this.createVADProcessor();
                  await this.audioContext.audioWorklet.addModule('/js/vad-processor.js');
                  
                  this.vadProcessor = new AudioWorkletNode(this.audioContext, 'vad-processor', {
                      processorOptions: {
                          frameSamples: this.vadSettings.frameSamples,
                          threshold: this.vadSettings.threshold || 0.5
                      }
                  });
                  
                  // Connect nodes
                  this.microphone.connect(this.analyser);
                  this.analyser.connect(this.vadProcessor);
                  this.vadProcessor.connect(this.audioContext.destination);
                  
                  // Handle messages from the processor
                  this.vadProcessor.port.onmessage = (event) => {
                      if (event.data.type === 'vad') {
                          this.processVADResult(event.data.isSpeech);
                      }
                  };
                  
              } catch (error) {
                  console.warn('AudioWorklet not supported, falling back to ScriptProcessor:', error);
                  this.setupLegacyProcessor();
              }
          } else {
              // Fallback for older browsers
              this.setupLegacyProcessor();
          }

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

          // Start recording
          this.isRecording = true;
          this.socket.emit('recording-status', { status: 'listening' });
          
          console.log('Audio recording started with VAD');

      } catch (error) {
          console.error('Failed to start recording:', error);
          this.socket.emit('recording-error', { error: error.message });
      }
  }

  // Create the VAD processor module dynamically
  async createVADProcessor() {
      const processorCode = `
          class VADProcessor extends AudioWorkletProcessor {
              constructor(options) {
                  super();
                  this.frameSamples = options.processorOptions.frameSamples || 1024;
                  this.threshold = options.processorOptions.threshold || 0.5;
                  this.buffer = [];
              }

              process(inputs, outputs, parameters) {
                  const input = inputs[0];
                  if (input.length > 0) {
                      const channelData = input[0];
                      
                      // Add to buffer
                      for (let i = 0; i < channelData.length; i++) {
                          this.buffer.push(channelData[i]);
                      }
                      
                      // Process when we have enough samples
                      while (this.buffer.length >= this.frameSamples) {
                          const frame = this.buffer.splice(0, this.frameSamples);
                          
                          // Calculate RMS energy
                          let sum = 0;
                          for (let i = 0; i < frame.length; i++) {
                              sum += frame[i] * frame[i];
                          }
                          const rms = Math.sqrt(sum / frame.length);
                          const energy = rms * 1000;
                          
                          // Simple VAD based on energy threshold
                          const isSpeech = energy > this.threshold;
                          
                          // Send result to main thread
                          this.port.postMessage({
                              type: 'vad',
                              isSpeech: isSpeech,
                              energy: energy
                          });
                      }
                  }
                  
                  return true; // Keep processor alive
              }
          }
          
          registerProcessor('vad-processor', VADProcessor);
      `;
      
      // Create a blob URL for the processor
      const blob = new Blob([processorCode], { type: 'application/javascript' });
      const processorUrl = URL.createObjectURL(blob);
      
      // Store the URL so we can revoke it later
      this.processorUrl = processorUrl;
      
      // Create a temporary file to serve the processor
      // Note: In production, you'd want to serve this as a static file
      const script = document.createElement('script');
      script.id = 'vad-processor-script';
      script.textContent = processorCode;
      document.head.appendChild(script);
  }

  // Fallback for browsers that don't support AudioWorklet
  setupLegacyProcessor() {
      const scriptProcessor = this.audioContext.createScriptProcessor(
          this.vadSettings.frameSamples,
          1,
          1
      );

      // Connect nodes
      this.microphone.connect(this.analyser);
      this.analyser.connect(scriptProcessor);
      scriptProcessor.connect(this.audioContext.destination);

      // Process audio for VAD
      scriptProcessor.onaudioprocess = (event) => {
          if (!this.isRecording) return;
          
          const inputData = event.inputBuffer.getChannelData(0);
          this.processVAD(inputData);
      };
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
      this.processVADResult(isSpeech);
  }

  processVADResult(isSpeech) {
      if (isSpeech) {
          if (!this.isSpeaking) {
              this.speechFrames++;
              if (this.speechFrames >= this.vadSettings.minSpeechFrames) {
                  this.isSpeaking = true;
                  this.speechFrames = 0;
                  this.silenceFrames = 0;
                  
                  // Start MediaRecorder
                  if (this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
                      this.mediaRecorder.start();
                      console.log('Started recording speech');
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
                  
                  // Stop MediaRecorder and send audio
                  if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                      this.mediaRecorder.stop();
                      console.log('Stopped recording speech');
                      this.socket.emit('recording-status', { status: 'listening' });
                  }
              }
          } else {
              this.speechFrames = 0;
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

      if (this.vadProcessor) {
          this.vadProcessor.disconnect();
          this.vadProcessor = null;
      }

      if (this.microphone) {
          this.microphone.disconnect();
      }

      if (this.audioContext) {
          this.audioContext.close();
      }

      // Clean up the processor URL if we created one
      if (this.processorUrl) {
          URL.revokeObjectURL(this.processorUrl);
          this.processorUrl = null;
      }

      // Remove the temporary script element
      const script = document.getElementById('vad-processor-script');
      if (script) {
          script.remove();
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
}

// Add to window for global access
window.AudioRecorder = AudioRecorder;