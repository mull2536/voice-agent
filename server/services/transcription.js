const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const dataStore = require('../utils/simpleDataStore');
const config = require('../config');

class TranscriptionService {
  constructor() {
    this.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    
    // Default to ElevenLabs Scribe
    this.useElevenLabs = true;
  }

  /**
   * Get language code for transcription
   */
  async getTranscriptionLanguage() {
    try {
      const settings = await dataStore.getSettings();
      
      // Check for transcription language setting first
      const transcriptionLang = settings?.recorder?.transcriptionLanguage;
      
      // If set to 'auto' or null, return null for automatic detection
      if (transcriptionLang === 'auto' || transcriptionLang === null) {
        return null;
      }
      
      // If specific language is set, use it
      if (transcriptionLang) {
        return transcriptionLang;
      }
      
      // Fallback to system default language
      const systemLang = settings?.system?.defaultLanguage || 'en';
      return systemLang;
    } catch (error) {
      logger.warn('Failed to get transcription language, defaulting to English:', error);
      return 'en';
    }
  }

  async transcribe(audioFilePath, clientContentType = 'audio/webm') {
    // Try ElevenLabs first, fallback to OpenAI if it fails
    try {
      if (this.useElevenLabs && this.elevenLabsApiKey) {
        return await this.transcribeWithElevenLabs(audioFilePath, clientContentType);
      } else {
        return await this.transcribeWithOpenAI(audioFilePath);
      }
    } catch (error) {
      logger.error('Primary transcription failed, trying fallback:', error);
      
      // If ElevenLabs failed, try OpenAI as fallback
      if (this.useElevenLabs && this.openaiApiKey) {
        logger.info('Falling back to OpenAI Whisper...');
        return await this.transcribeWithOpenAI(audioFilePath);
      }
      
      throw error;
    }
  }

  async transcribeWithElevenLabs(audioFilePath, clientContentType = 'audio/webm') {
    if (!this.elevenLabsApiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    try {
      const language = await this.getTranscriptionLanguage();
      
      // Check if v3 model is selected to enable audio event tagging
      const settings = await dataStore.getSettings();
      const isV3Model = settings?.tts?.model === 'eleven_v3';

      const url = 'https://api.elevenlabs.io/v1/speech-to-text';
      const headers = { 'xi-api-key': this.elevenLabsApiKey };
      
      const form = new FormData();
      form.append('file', fs.createReadStream(audioFilePath), {
        filename: path.basename(audioFilePath),
        contentType: clientContentType
      });
      form.append('model_id', 'scribe_v1');
      
      // Only add language_code if not null (for automatic detection)
      if (language !== null) {
        form.append('language_code', language);
      }
      
      form.append('tag_audio_events', isV3Model ? 'true' : 'false');
      
      // Log if audio event tagging is enabled
      if (isV3Model) {
        logger.info('Audio event tagging enabled for v3 model transcription');
      }
      
      const formHeaders = form.getHeaders();
      
      logger.info(`Starting ElevenLabs Scribe transcription (${language || 'auto'})...`);
      
      const response = await axios.post(url, form, {
        headers: { ...headers, ...formHeaders },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      
      const transcript = response.data?.text || '';
      
      logger.info(`ElevenLabs transcription completed (${language || 'auto'}): ${transcript.substring(0, 50)}...`);
      
      // Clean up the audio file after transcription
      try {
        fs.unlinkSync(audioFilePath);
      } catch (error) {
        logger.warn('Failed to delete audio file:', error);
      }
      
      return transcript;
      
    } catch (error) {
      logger.error('ElevenLabs transcription error:', error);
      
      if (error.response) {
        logger.error('Status:', error.response.status);
        logger.error('Headers:', JSON.stringify(error.response.headers, null, 2));
        logger.error('Data:', JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        logger.error('No response received from ElevenLabs');
      } else {
        logger.error('Error:', error.message);
      }
      
      throw error;
    }
  }

  async transcribeWithOpenAI(audioFilePath) {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const { OpenAI } = require('openai');
      const openai = new OpenAI({
        apiKey: this.openaiApiKey
      });

      const language = await this.getTranscriptionLanguage();
      
      // Create read stream for the audio file
      const audioStream = fs.createReadStream(audioFilePath);
      
      logger.info(`Starting OpenAI Whisper transcription (${language || 'auto'})...`);
      
      // Build transcription parameters
      const transcriptionParams = {
        file: audioStream,
        model: 'whisper-1'
      };
      
      // Only add language parameter if not null (for automatic detection)
      if (language !== null) {
        transcriptionParams.language = language;
        // Add language-specific prompt
        transcriptionParams.prompt = language === 'nl' ? 'Dit is een gesprek in het Nederlands.' : 
                                    language === 'es' ? 'Esta es una conversación en español.' : 
                                    'This is a conversation in English.';
      }
      
      // Use OpenAI Whisper for transcription
      const response = await openai.audio.transcriptions.create(transcriptionParams);
      
      const transcript = response.text;
      logger.info(`OpenAI transcription completed (${language || 'auto'}): ${transcript.substring(0, 50)}...`);
      
      // Clean up the audio file after transcription
      try {
        fs.unlinkSync(audioFilePath);
      } catch (error) {
        logger.warn('Failed to delete audio file:', error);
      }
      
      return transcript;
      
    } catch (error) {
      logger.error('OpenAI transcription failed:', error);
      throw error;
    }
  }

  /**
   * Toggle between ElevenLabs and OpenAI
   */
  setTranscriptionService(useElevenLabs = true) {
    this.useElevenLabs = useElevenLabs;
    logger.info(`Transcription service set to: ${useElevenLabs ? 'ElevenLabs Scribe' : 'OpenAI Whisper'}`);
  }

  /**
   * Get current transcription service
   */
  getCurrentService() {
    return this.useElevenLabs ? 'ElevenLabs Scribe' : 'OpenAI Whisper';
  }
}

module.exports = TranscriptionService;