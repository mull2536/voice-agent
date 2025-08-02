const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const logger = require('../utils/logger');

class TranscriptionService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async transcribe(audioFilePath) {
    try {
      let finalPath = audioFilePath;
      
      // If it's a webm file, convert to wav first
      if (audioFilePath.endsWith('.webm')) {
        const wavPath = audioFilePath.replace('.webm', '.wav');
        
        try {
          // Try using ffmpeg if available
          await execAsync(`ffmpeg -i "${audioFilePath}" -ar 16000 -ac 1 "${wavPath}"`);
          finalPath = wavPath;
          logger.info('Converted webm to wav using ffmpeg');
        } catch (error) {
          // If ffmpeg fails, use the webm directly (OpenAI accepts webm)
          logger.info('Using webm file directly for transcription');
        }
      }
      
      // Create read stream for the audio file
      const audioStream = fs.createReadStream(finalPath);
      
      // Use OpenAI Whisper for transcription
      const response = await this.openai.audio.transcriptions.create({
        file: audioStream,
        model: 'whisper-1',
        language: 'en'
      });
      
      const transcript = response.text;
      logger.info(`Transcription completed: ${transcript.substring(0, 50)}...`);
      
      // Clean up files
      try {
        fs.unlinkSync(audioFilePath);
        if (finalPath !== audioFilePath && fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
        }
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