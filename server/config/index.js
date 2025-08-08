const path = require('path');
const fs = require('fs');

// Function to load and merge settings
function loadSettings() {
  const settingsPath = path.join(__dirname, '../../data/settings.json');
  
  // Default settings structure
  const defaultSettings = {
    llm: {
      model: 'gpt-4.1-mini',
      temperature: 0.7,
      maxTokens: 150,
      systemPrompt: ''  // Empty means use default from LLM service
    },
    tts: {
      voiceId: 'JBFqnCBsd6RMkjVDRZzb',  // Default voice ID as requested
      speechRate: 1.0,
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.0,
      useSpeakerBoost: true,
      seed: null,
      fixedSeed: false
    },
    transcription: {
      language: 'en'  // Default to English
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
      defaultLanguage: 'en'  // en, nl, es
    }
  };
  
  try {
    // Create data directory if it doesn't exist
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Check if settings.json exists
    if (!fs.existsSync(settingsPath)) {
      // Create default settings.json
      fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
      console.log('Created default settings.json');
      return defaultSettings;
    }
    
    // Load existing settings
    const fileContent = fs.readFileSync(settingsPath, 'utf-8');
    const loadedSettings = JSON.parse(fileContent);
    
    // Deep merge with defaults to ensure all properties exist
    const mergedSettings = deepMerge(defaultSettings, loadedSettings);
    
    return mergedSettings;
  } catch (error) {
    console.error('Error loading settings.json:', error);
    return defaultSettings;
  }
}

// Deep merge helper function
function deepMerge(target, source) {
  const output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target))
          Object.assign(output, { [key]: source[key] });
        else
          output[key] = deepMerge(target[key], source[key]);
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

// Load settings on startup
const settings = loadSettings();

// Create required directories on startup
const requiredDirs = [
  path.join(__dirname, '../../data/vector_store'),
  path.join(__dirname, '../../data/kb'),
  path.join(__dirname, '../../data/recordings'),
  path.join(__dirname, '../../data/archives'),
  path.join(__dirname, '../../data/logs')
];

requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// Create required JSON files if they don't exist
const requiredFiles = {
  'conversations.json': '[]',
  'people.json': JSON.stringify([
    { id: 'family', name: 'Family Member', notes: 'General family conversations', addedAt: new Date().toISOString() },
    { id: 'caregiver', name: 'Caregiver', notes: 'Daily care and assistance', addedAt: new Date().toISOString() },
    { id: 'doctor', name: 'Doctor', notes: 'Medical discussions', addedAt: new Date().toISOString() },
    { id: 'friend', name: 'Friend', notes: 'Social conversations', addedAt: new Date().toISOString() },
    { id: 'other', name: 'Other', notes: 'Anyone else', addedAt: new Date().toISOString() }
  ], null, 2)
};

Object.entries(requiredFiles).forEach(([filename, content]) => {
  const filepath = path.join(__dirname, '../../data', filename);
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, content);
    console.log(`Created default ${filename}`);
  }
});

const config = {
  // Server settings
  port: parseInt(process.env.PORT) || 5050,
  env: process.env.NODE_ENV || 'development',
  
  // Paths - from environment variables only
  paths: {
    vectorStore: process.env.VECTOR_STORE_PATH || path.join(__dirname, '../../data/vector_store'),
    knowledgeBase: process.env.KNOWLEDGE_BASE_PATH || path.join(__dirname, '../../data/kb'),
    recordings: process.env.RECORDINGS_PATH || path.join(__dirname, '../../data/recordings'),
    archives: process.env.ARCHIVES_PATH || path.join(__dirname, '../../data/archives')
  },
  
  // Settings from settings.json
  settings: settings,
  
  // LLM settings (merged)
  llm: {
    model: settings.llm.model || process.env.LLM_MODEL || 'gpt-4.1-mini',
    temperature: settings.llm.temperature || parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
    maxTokens: settings.llm.maxTokens || parseInt(process.env.LLM_MAX_TOKENS) || 150,
    systemPrompt: settings.llm.systemPrompt || ''  // Empty string means use default
  },
  
  // TTS settings (merged)
  tts: {
    voiceId: settings.tts.voiceId || process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb',
    speechRate: settings.tts.speechRate || 1.0,
    stability: settings.tts.stability || parseFloat(process.env.TTS_STABILITY) || 0.5,
    similarityBoost: settings.tts.similarityBoost || parseFloat(process.env.TTS_SIMILARITY_BOOST) || 0.75,
    style: settings.tts.style || parseFloat(process.env.TTS_STYLE) || 0.0,
    useSpeakerBoost: settings.tts.useSpeakerBoost !== undefined ? settings.tts.useSpeakerBoost : process.env.TTS_USE_SPEAKER_BOOST === 'true',
    seed: settings.tts.seed || null,
    fixedSeed: settings.tts.fixedSeed || false
  },
  
  // Transcription settings
  transcription: {
    language: settings.transcription?.language || settings.system?.defaultLanguage || 'en'
  },
  
  // VAD settings (merged)
  vad: {
    positiveSpeechThreshold: settings.vad.positiveSpeechThreshold || parseFloat(process.env.VAD_POSITIVE_THRESHOLD) || 0.4,
    negativeSpeechThreshold: settings.vad.negativeSpeechThreshold || parseFloat(process.env.VAD_NEGATIVE_THRESHOLD) || 0.55,
    minSpeechFrames: settings.vad.minSpeechFrames || parseInt(process.env.VAD_MIN_SPEECH_FRAMES) || 8,
    preSpeechPadFrames: settings.vad.preSpeechPadFrames || parseInt(process.env.VAD_PRE_SPEECH_PAD_FRAMES) || 3,
    redemptionFrames: settings.vad.redemptionFrames || parseInt(process.env.VAD_REDEMPTION_FRAMES) || 30,
    threshold: settings.vad.threshold || parseFloat(process.env.VAD_THRESHOLD) || 0.5,
    minSpeechDuration: settings.vad.minSpeechDuration || parseInt(process.env.VAD_MIN_SPEECH_DURATION) || 250,
    maxSpeechDuration: settings.vad.maxSpeechDuration || parseInt(process.env.VAD_MAX_SPEECH_DURATION) || 10000
  },
  
  // Eye gaze settings
  eyeGaze: settings.eyeGaze || {
    hoverDuration: parseInt(process.env.HOVER_DURATION) || 3000,
    visualFeedback: process.env.VISUAL_FEEDBACK !== 'false'
  },
  
  // RAG settings
  rag: {
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
    chunkSize: settings.rag?.chunkSize || parseInt(process.env.CHUNK_SIZE) || 1000,
    chunkOverlap: settings.rag?.chunkOverlap || parseInt(process.env.CHUNK_OVERLAP) || 200,
    topK: settings.rag?.topK || parseInt(process.env.TOP_K_RESULTS) || 5
  },
  
  // Speaker recognition
  speakerRecognition: {
    enabled: process.env.SPEAKER_RECOGNITION_ENABLED === 'true',
    threshold: parseFloat(process.env.SPEAKER_RECOGNITION_THRESHOLD) || 0.85
  },
  
  // Internet search
  internetSearch: {
    enabled: settings.internetSearch?.enabled !== undefined ? settings.internetSearch.enabled : process.env.AUTO_SEARCH_ENABLED === 'true'
  },
  
  // System settings
  system: settings.system || {
    defaultLanguage: 'en'
  }
};

// Validate required environment variables (API keys only)
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    console.error(`Please add ${envVar} to your .env file`);
    process.exit(1);
  }
}

// Function to reload settings (useful for dynamic updates)
config.reloadSettings = function() {
  const newSettings = loadSettings();
  Object.assign(settings, newSettings);
  
  // Update config properties that depend on settings
  config.llm.model = settings.llm.model || config.llm.model;
  config.llm.temperature = settings.llm.temperature || config.llm.temperature;
  config.llm.maxTokens = settings.llm.maxTokens || config.llm.maxTokens;
  config.llm.systemPrompt = settings.llm.systemPrompt || '';
  
  // Update other merged properties...
  // (similar updates for tts, transcription, vad, etc.)
  
  console.log('Settings reloaded');
};

module.exports = config;