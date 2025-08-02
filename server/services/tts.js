// server/services/tts.js

const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const logger = require('../utils/logger');

class TTSService {
  constructor() {
    // Initialize the ElevenLabs client with your API key
    this.client = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY
    });

    // Load your default voice ID from env
    this.voiceId = process.env.ELEVENLABS_VOICE_ID;

    // Prepare camel-cased voice settings
    this.voiceSettings = {
      stability:       parseFloat(process.env.TTS_STABILITY)       || 0.5,
      similarityBoost: parseFloat(process.env.TTS_SIMILARITY_BOOST) || 0.75,
      style:           parseFloat(process.env.TTS_STYLE)           || 0.0,
      useSpeakerBoost: process.env.TTS_USE_SPEAKER_BOOST === 'true'
    };
  }

  /**
   * Synthesize speech for the given text.
   * Returns a Base64-encoded MP3 string.
   */
  async synthesize(text) {
    try {
      // ⚠️ Use two arguments: (voiceId, options)
      const audioStream = await this.client.textToSpeech.convert(
        this.voiceId,
        {
          text,                                    // required
          modelId:     'eleven_multilingual_v2',   // camelCase
          outputFormat:'mp3_44100_192',            // camelCase
          enableLogging: false,                    // optional
          voiceSettings: {                         // camelCase inner keys
            stability:       this.voiceSettings.stability,
            similarityBoost: this.voiceSettings.similarityBoost,
            style:           this.voiceSettings.style,
            useSpeakerBoost: this.voiceSettings.useSpeakerBoost
          }
        }
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
      const axios = require('axios');
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
        {
          text,
          model_id:      'eleven_multilingual_v2', // snake_case for HTTP API
          output_format: 'mp3_44100_192',
          voice_settings:{
            stability:       this.voiceSettings.stability,
            similarity_boost:this.voiceSettings.similarityBoost,
            style:           this.voiceSettings.style,
            use_speaker_boost:this.voiceSettings.useSpeakerBoost
          }
        },
        {
          headers: {
            'Accept':        'audio/mpeg',
            'Content-Type':  'application/json',
            'xi-api-key':    process.env.ELEVENLABS_API_KEY
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
      stability:       newSettings.stability ?? this.voiceSettings.stability,
      similarityBoost: newSettings.similarityBoost ?? this.voiceSettings.similarityBoost,
      style:           newSettings.style ?? this.voiceSettings.style,
      useSpeakerBoost: newSettings.useSpeakerBoost ?? this.voiceSettings.useSpeakerBoost
    });
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
      const resp  = await axios.get('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
      });
      return resp.data.voices;
    }
  }
}

module.exports = TTSService;
