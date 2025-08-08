const express = require('express');
const router = express.Router();
const dataStore = require('../utils/simpleDataStore');
const config = require('../config');
const logger = require('../utils/logger');

// Get all settings
router.get('/', async (req, res) => {
  try {
    const savedSettings = await dataStore.getSettings();
    
    // Merge with default config
    const allSettings = {
      llm: { ...config.llm, ...savedSettings.llm },
      tts: { ...config.tts, ...savedSettings.tts },
      vad: { ...config.vad, ...savedSettings.vad },
      eyeGaze: { ...config.eyeGaze, ...savedSettings.eyeGaze },
      rag: { ...config.rag, ...savedSettings.rag },
      internetSearch: { ...config.internetSearch, ...savedSettings.internetSearch }
    };
    
    res.json({
      success: true,
      settings: allSettings
    });
  } catch (error) {
    logger.error('Failed to get settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve settings'
    });
  }
});

// Update settings
router.put('/', async (req, res) => {
  try {
    const updates = req.body;
    
    // Log what we're receiving for debugging (simplified)
    logger.info('Received settings update for categories:', Object.keys(updates).join(', '));
    
    // Clean up any unwanted properties
    if (updates.tts) {
      // Remove properties that shouldn't be saved
      delete updates.tts.model;
      delete updates.tts.outputQuality;
      delete updates.tts.useFixedSeed;
      
      // Ensure fixedSeed is boolean, not null
      if (updates.tts.fixedSeed === null) {
        updates.tts.fixedSeed = false;
      }
      
      // Ensure seed is either a number or null
      if (updates.tts.seed === '' || updates.tts.seed === undefined) {
        updates.tts.seed = null;
      }
    }
    
    // Ensure model is set for LLM
    if (updates.llm && !updates.llm.model) {
      updates.llm.model = 'gpt-4.1-mini';
    }
    
    // Save settings
    await dataStore.updateSettings(updates);
    
    // Try to reload config if possible (without crashing)
    try {
      if (config.reloadSettings && typeof config.reloadSettings === 'function') {
        config.reloadSettings();
      }
    } catch (reloadError) {
      logger.warn('Failed to reload config:', reloadError);
      // Don't crash, just log the warning
    }
    
    logger.info('Settings updated successfully');
    
    res.json({
      success: true,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    logger.error('Failed to update settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update settings',
      details: error.message
    });
  }
});

// Update a specific setting category
router.put('/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const categorySettings = req.body;
    
    // Validate category
    const validCategories = ['llm', 'tts', 'vad', 'eyeGaze', 'rag', 'internetSearch'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid settings category'
      });
    }
    
    // Get current settings
    const currentSettings = await dataStore.getSettings();
    
    // Update specific category
    const newSettings = {
      ...currentSettings,
      [category]: categorySettings
    };
    
    // Save settings
    await dataStore.updateSettings(newSettings);
    
    logger.info(`Settings updated for category: ${category}`);
    
    res.json({
      success: true,
      message: `${category} settings updated successfully`,
      settings: newSettings[category]
    });
  } catch (error) {
    logger.error('Failed to update settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update settings'
    });
  }
});

// Reset settings to defaults
router.post('/reset', async (req, res) => {
  try {
    const { category } = req.body;
    
    // Define defaults with correct values
    const defaults = {
      llm: {
        model: 'gpt-4.1-mini',
        temperature: 0.7,
        maxTokens: 150,  // Fixed to 150
        systemPrompt: ''
      },
      tts: {
        voiceId: 'JBFqnCBsd6RMkjVDRZzb',
        speechRate: 1.0,
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0.0,
        useSpeakerBoost: true,
        seed: null,
        fixedSeed: false
      },
      vad: {
        positiveSpeechThreshold: 0.4,
        negativeSpeechThreshold: 0.55,
        minSpeechFrames: 8,
        preSpeechPadFrames: 3,
        redemptionFrames: 30,
        threshold: 0.5,
        minSpeechDuration: 250,
        maxSpeechDuration: 10000
      },
      eyeGaze: {
        hoverDuration: 3000,
        visualFeedback: true
      },
      rag: {
        chunkSize: 1000,
        chunkOverlap: 200,
        topK: 5
      },
      internetSearch: {
        enabled: true,
        maxResults: 3
      },
      system: {
        defaultLanguage: 'en'
      }
    };
    
    if (category && defaults[category]) {
      // Reset specific category
      const currentSettings = await dataStore.getSettings();
      const newSettings = {
        ...currentSettings,
        [category]: defaults[category]
      };
      
      await dataStore.updateSettings(newSettings);
      
      logger.info(`Reset ${category} settings to defaults`);
      
      res.json({
        success: true,
        message: `${category} settings reset to defaults`,
        settings: defaults[category]
      });
    } else {
      // Reset all settings
      await dataStore.updateSettings(defaults);
      
      logger.info('All settings reset to defaults');
      
      res.json({
        success: true,
        message: 'All settings reset to defaults',
        settings: defaults
      });
    }
  } catch (error) {
    logger.error('Failed to reset settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset settings'
    });
  }
});

// Get available voices from ElevenLabs
router.get('/voices', async (req, res) => {
  try {
    const TTSService = require('../services/tts');
    const tts = new TTSService();
    
    // This will return the voices array from ElevenLabs
    // The listVoices method handles both SDK and HTTP fallback
    const voicesData = await tts.listVoices();
    
    // Check if we got the voices directly or wrapped
    let voices = [];
    if (Array.isArray(voicesData)) {
      voices = voicesData;
    } else if (voicesData && voicesData.voices) {
      voices = voicesData.voices;
    }
    
    logger.info(`Retrieved ${voices.length} voices from ElevenLabs`);
    
    res.json({
      success: true,
      voices: voices
    });
  } catch (error) {
    logger.error('Failed to get voices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve voices from ElevenLabs',
      voices: [] // Return empty array on error
    });
  }
});

module.exports = router;