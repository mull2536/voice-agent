// server/services/tts.js

const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const logger = require('../utils/logger');
const config = require('../config');
const dataStore = require('../utils/simpleDataStore');

class TTSService {
  constructor() {
    // Initialize the ElevenLabs client with your API key
    this.client = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY
    });

    // Load initial voice settings from config
    this.voiceId = config.tts.voiceId || process.env.ELEVENLABS_VOICE_ID;
    this.voiceSettings = {
      stability: config.tts.stability,
      similarityBoost: config.tts.similarityBoost,
      style: config.tts.style,
      useSpeakerBoost: config.tts.useSpeakerBoost
    };
    
    // Speech rate and seed settings
    this.speechRate = config.tts.speechRate || 1.0;
    this.seed = config.tts.seed || null;
    this.fixedSeed = config.tts.fixedSeed || false;
  }

  /**
   * Get current settings from dataStore
   */
  async getCurrentSettings() {
    try {
      const settings = await dataStore.getSettings();
      return settings.tts || {};
    } catch (error) {
      logger.warn('Failed to get TTS settings, using defaults:', error);
      return {};
    }
  }

  /**
   * Synthesize speech for the given text.
   * Returns a Base64-encoded MP3 string.
   */
  async synthesize(text) {
    try {
      // Get current settings
      const currentSettings = await this.getCurrentSettings();
      
      // Use settings from dataStore, fallback to config/defaults
      const voiceId = currentSettings.voiceId || this.voiceId;
      const speechRate = currentSettings.speechRate !== undefined ? currentSettings.speechRate : this.speechRate;
      const fixedSeed = currentSettings.fixedSeed !== undefined ? currentSettings.fixedSeed : this.fixedSeed;
      const seed = fixedSeed && currentSettings.seed ? currentSettings.seed : null;
      
      // Prepare request options
      const options = {
        text,
        modelId: 'eleven_multilingual_v2',
        outputFormat: 'mp3_44100_192',
        enableLogging: false,
        voiceSettings: {
          stability: currentSettings.stability !== undefined ? currentSettings.stability : this.voiceSettings.stability,
          similarityBoost: currentSettings.similarityBoost !== undefined ? currentSettings.similarityBoost : this.voiceSettings.similarityBoost,
          style: currentSettings.style !== undefined ? currentSettings.style : this.voiceSettings.style,
          useSpeakerBoost: currentSettings.useSpeakerBoost !== undefined ? currentSettings.useSpeakerBoost : this.voiceSettings.useSpeakerBoost
        }
      };
      
      // Add speed (speechRate) to the payload - ElevenLabs expects 'speed' parameter
      if (speechRate !== 1.0) {
        options.speed = speechRate; // Value between 0-1, where 1.0 is normal speed
      }
      
      // Add seed if enabled
      if (seed !== null && fixedSeed) {
        options.seed = parseInt(seed);
        logger.info(`Using fixed seed for TTS: ${seed}`);
      }
      
      logger.info(`TTS synthesis with voiceId: ${voiceId}, speed: ${speechRate}, seed: ${seed || 'random'}`);
      
      // Use two arguments: (voiceId, options)
      const audioStream = await this.client.textToSpeech.convert(
        voiceId,
        options
      );

      // Accumulate the stream into a Buffer
      const chunks = [];
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);

      logger.info(`TTS synthesis completed for: "${text.slice(0,30)}..."`);
      return audioBuffer.toString('base64');

    } catch (error) {
      logger.error('TTS synthesis failed:', error);
      // Fallback to direct HTTP call if SDK fails
      return this.synthesizeFallback(text);
    }
  }

  /**
   * Fallback method using direct ElevenLabs HTTP API.
   */
  async synthesizeFallback(text) {
    try {
      const currentSettings = await this.getCurrentSettings();
      const voiceId = currentSettings.voiceId || this.voiceId;
      const speechRate = currentSettings.speechRate !== undefined ? currentSettings.speechRate : this.speechRate;
      const fixedSeed = currentSettings.fixedSeed !== undefined ? currentSettings.fixedSeed : this.fixedSeed;
      const seed = fixedSeed && currentSettings.seed ? parseInt(currentSettings.seed) : null;
      
      const axios = require('axios');
      
      const payload = {
        text,
        model_id: 'eleven_multilingual_v2',
        output_format: 'mp3_44100_192',
        voice_settings: {
          stability: currentSettings.stability !== undefined ? currentSettings.stability : this.voiceSettings.stability,
          similarity_boost: currentSettings.similarityBoost !== undefined ? currentSettings.similarityBoost : this.voiceSettings.similarityBoost,
          style: currentSettings.style !== undefined ? currentSettings.style : this.voiceSettings.style,
          use_speaker_boost: currentSettings.useSpeakerBoost !== undefined ? currentSettings.useSpeakerBoost : this.voiceSettings.useSpeakerBoost
        }
      };
      
      // Add speed to payload if not default
      if (speechRate !== 1.0) {
        payload.speed = speechRate;
      }
      
      // Add seed if enabled
      if (seed !== null && fixedSeed) {
        payload.seed = seed;
      }
      
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        payload,
        {
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': process.env.ELEVENLABS_API_KEY
          },
          responseType: 'arraybuffer'
        }
      );

      const audioBuffer = Buffer.from(response.data);
      return audioBuffer.toString('base64');

    } catch (error) {
      logger.error('TTS fallback also failed:', error);
      throw error;
    }
  }

  /**
   * Dynamically update voice settings at runtime.
   */
  async updateVoiceSettings(newSettings) {
    Object.assign(this.voiceSettings, {
      stability: newSettings.stability ?? this.voiceSettings.stability,
      similarityBoost: newSettings.similarityBoost ?? this.voiceSettings.similarityBoost,
      style: newSettings.style ?? this.voiceSettings.style,
      useSpeakerBoost: newSettings.useSpeakerBoost ?? this.voiceSettings.useSpeakerBoost
    });
    
    // Update speech rate and seed settings
    if (newSettings.speechRate !== undefined) {
      this.speechRate = newSettings.speechRate;
    }
    if (newSettings.seed !== undefined) {
      this.seed = newSettings.seed;
    }
    if (newSettings.fixedSeed !== undefined) {
      this.fixedSeed = newSettings.fixedSeed;
    }
    
    logger.info('TTS voice settings updated:', this.voiceSettings);
  }

  /**
   * List available voices via the SDK, with HTTP fallback.
   */
  async listVoices() {
    try {
      return await this.client.voices.getAll();
    } catch (error) {
      logger.error('Failed to list voices via SDK:', error);
      // HTTP fallback
      const axios = require('axios');
      const resp = await axios.get('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
      });
      return resp.data.voices;
    }
  }
}

module.exports = TTSService;