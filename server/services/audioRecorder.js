const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class AudioRecorder {
  constructor(io) {
    this.io = io;
    this.isRecording = false;
    
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

  async startRecording() {
    if (this.isRecording) {
      logger.warn('Recording already in progress');
      return;
    }

    this.isRecording = true;
    logger.info('Recording started (waiting for client audio)');
    
    // Notify client to start recording
    this.io.emit('start-client-recording', this.vadSettings);
  }

  async stopRecording() {
    if (!this.isRecording) {
      logger.warn('No recording in progress');
      return;
    }

    this.isRecording = false;
    logger.info('Recording stopped');
    
    // Notify client to stop recording
    this.io.emit('stop-client-recording');
  }

  async processAudioData(audioData) {
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
      
      logger.info(`Audio saved: ${filename}`);
      
      // Return file info for transcription
      return {
        filename,
        filepath,
        timestamp,
        size: buffer.length
      };
    } catch (error) {
      logger.error('Failed to process audio data:', error);
      throw error;
    }
  }

  async cleanup() {
    await this.stopRecording();
  }
}

module.exports = AudioRecorder;