const { OpenAI } = require('openai');
const fs = require('fs');
const logger = require('../utils/logger');

class TranscriptionService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async transcribe(audioFilePath) {
    try {
      // Create read stream for the audio file
      const audioStream = fs.createReadStream(audioFilePath);
      
      // Use OpenAI Whisper for transcription
      const response = await this.openai.audio.transcriptions.create({
        file: audioStream,
        model: 'whisper-1',
        language: 'en'
      });
      
      const transcript = response.text;
      logger.info(`Transcription completed: ${transcript.substring(0, 50)}...`);
      
      // Clean up the audio file after transcription
      try {
        fs.unlinkSync(audioFilePath);
      } catch (error) {
        logger.warn('Failed to delete audio file:', error);
      }
      
      return transcript;
      
    } catch (error) {
      logger.error('Transcription failed:', error);
      throw error;
    }
  }
}

module.exports = TranscriptionService;