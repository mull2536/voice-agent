const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class AudioRecorder {
  constructor(io) {
    this.io = io;
    this.isRecording = false;
    this.activeConnections = new Set(); // Track active recording connections
    
    // Silero VAD settings from your screenshot
    this.vadSettings = {
      positiveSpeechThreshold: 0.4,
      negativeSpeechThreshold: 0.55,
      minSpeechFrames: 8,
      preSpeechPadFrames: 3,
      redemptionFrames: 30,
      frameSamples: 1024, // 64ms at 16kHz (use power of 2)
      sampleRate: 16000
    };
  }

  async startRecording(socketId = null) {
    if (this.isRecording) {
      logger.warn('Recording already in progress');
      return;
    }

    this.isRecording = true;
    
    // Track the socket that started recording
    if (socketId) {
      this.activeConnections.add(socketId);
    }
    
    logger.info('Recording started (waiting for client audio)');
    
    // Notify client to start recording
    this.io.emit('start-client-recording', this.vadSettings);
  }

  async stopRecording(socketId = null) {
    if (!this.isRecording) {
      logger.warn('No recording in progress');
      return;
    }

    // Remove the socket from active connections
    if (socketId) {
      this.activeConnections.delete(socketId);
    }

    this.isRecording = false;
    logger.info('Recording stopped - processing any pending audio');
    
    // Notify client to stop recording and process pending audio
    this.io.emit('stop-client-recording');
    
    // Give a moment for final audio chunks to be processed
    setTimeout(() => {
      logger.info('Recording stop sequence completed');
    }, 1000);
  }

  async processAudioData(audioData, options = {}) {
    try {
      // Save the audio data to a file
      const timestamp = Date.now();
      const filename = `speech_${timestamp}.webm`;
      const filepath = path.join(process.env.RECORDINGS_PATH, filename);
      
      // Ensure directory exists
      const dir = process.env.RECORDINGS_PATH;
      await fs.mkdir(dir, { recursive: true });
      
      // Convert base64 to buffer and save
      const buffer = Buffer.from(audioData, 'base64');
      await fs.writeFile(filepath, buffer);
      
      logger.info(`Audio saved: ${filename}${options.finalChunk ? ' (final chunk)' : ''}`);
      
      // Return file info for transcription
      return {
        filename,
        filepath,
        timestamp,
        size: buffer.length,
        finalChunk: options.finalChunk || false
      };
    } catch (error) {
      logger.error('Failed to process audio data:', error);
      throw error;
    }
  }

  async cleanup() {
    await this.stopRecording();
    this.activeConnections.clear();
  }

  // Method to check if a specific socket is actively recording
  isSocketRecording(socketId) {
    return this.activeConnections.has(socketId);
  }

  // Method to handle socket disconnection
  async handleSocketDisconnect(socketId) {
    if (this.activeConnections.has(socketId)) {
      logger.info(`Cleaning up recording for disconnected socket: ${socketId}`);
      await this.stopRecording(socketId);
    }
  }
}

module.exports = AudioRecorder;