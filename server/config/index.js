const path = require('path');

const config = {
  // Server settings
  port: parseInt(process.env.PORT) || 5050,
  env: process.env.NODE_ENV || 'development',
  
  // Paths
  paths: {
    vectorStore: process.env.VECTOR_STORE_PATH || path.join(__dirname, '../../data/vector_store'),
    knowledgeBase: process.env.KNOWLEDGE_BASE_PATH || path.join(__dirname, '../../data/kb'),
    recordings: process.env.RECORDINGS_PATH || path.join(__dirname, '../../data/recordings'),
    archives: process.env.ARCHIVES_PATH || path.join(__dirname, '../../data/archives')
  },
  
  // LLM settings
  llm: {
    model: process.env.LLM_MODEL || 'gpt-4-0125-preview',
    temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.7,
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 500
  },
  
  // TTS settings
  tts: {
    voiceId: process.env.ELEVENLABS_VOICE_ID,
    stability: parseFloat(process.env.TTS_STABILITY) || 0.5,
    similarityBoost: parseFloat(process.env.TTS_SIMILARITY_BOOST) || 0.75,
    style: parseFloat(process.env.TTS_STYLE) || 0.0,
    useSpeakerBoost: process.env.TTS_USE_SPEAKER_BOOST === 'true'
  },
  
  // VAD settings
  vad: {
    threshold: parseFloat(process.env.VAD_THRESHOLD) || 0.5,
    minSpeechDuration: parseInt(process.env.VAD_MIN_SPEECH_DURATION) || 250,
    maxSpeechDuration: parseInt(process.env.VAD_MAX_SPEECH_DURATION) || 10000
  },
  
  // Eye gaze settings
  eyeGaze: {
    hoverDuration: parseInt(process.env.HOVER_DURATION) || 3000,
    visualFeedback: process.env.VISUAL_FEEDBACK !== 'false'
  },
  
  // RAG settings
  rag: {
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
    chunkSize: parseInt(process.env.CHUNK_SIZE) || 1000,
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP) || 200,
    topK: parseInt(process.env.TOP_K_RESULTS) || 5
  },
  
  // Speaker recognition
  speakerRecognition: {
    enabled: process.env.SPEAKER_RECOGNITION_ENABLED === 'true',
    threshold: parseFloat(process.env.SPEAKER_RECOGNITION_THRESHOLD) || 0.85
  },
  
  // Internet search
  internetSearch: {
    autoEnabled: process.env.AUTO_SEARCH_ENABLED === 'true'
  }
};

// Validate required environment variables
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

module.exports = config;