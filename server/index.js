require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const config = require('./config');
const { initializeRAG } = require('./services/rag');
const { startFileWatcher } = require('./utils/fileIndexer');
const logger = require('./utils/logger');
const dataStore = require('./utils/simpleDataStore');

// Import routes
const conversationRoutes = require('./routes/conversation');
const settingsRoutes = require('./routes/settings');
const peopleRoutes = require('./routes/people');

// Import services
const AudioRecorder = require('./services/audioRecorder');
const TranscriptionService = require('./services/transcription');
const LLMService = require('./services/llm');
const TTSService = require('./services/tts');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use('/assets', express.static(path.join(__dirname, '../client/assets')));
// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Routes
app.use('/api/conversation', conversationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/people', peopleRoutes);

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Initialize services
let audioRecorder;
let transcriptionService;
let llmService;
let ttsService;

async function initializeServices() {
  try {
    logger.info('Initializing services...');
    
    // Initialize RAG system
    await initializeRAG();
    
    // Start file watcher for knowledge base
    startFileWatcher();
    
    // Initialize services
    audioRecorder = new AudioRecorder(io);
    transcriptionService = new TranscriptionService();
    llmService = new LLMService();
    ttsService = new TTSService();
    
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info('Client connected:', socket.id);
  
  // Store current person context for this socket
  socket.data.currentPerson = null;
  
  // Set current person for conversation
  socket.on('set-person', async (personId) => {
    try {
      const people = await dataStore.getPeople();
      const person = people.find(p => p.id === personId);
      
      if (person) {
        socket.data.currentPerson = person;
        socket.emit('person-set', { person });
        logger.info(`Person set for socket ${socket.id}: ${person.name}`);
      }
    } catch (error) {
      logger.error('Failed to set person:', error);
      socket.emit('error', { message: 'Failed to set person' });
    }
  });
  
  // Recording controls
  socket.on('start-recording', async () => {
    try {
      await audioRecorder.startRecording(socket.id);
      socket.emit('recording-started');
    } catch (error) {
      logger.error('Failed to start recording:', error);
      socket.emit('error', { message: 'Failed to start recording' });
    }
  });
  
  socket.on('stop-recording', async () => {
    try {
      await audioRecorder.stopRecording(socket.id);
      socket.emit('recording-stopped');
    } catch (error) {
      logger.error('Failed to stop recording:', error);
      socket.emit('error', { message: 'Failed to stop recording' });
    }
  });
  
  // Process audio from client
  socket.on('audio-data', async (data) => {
    try {
      // Save audio data with enhanced final chunk handling
      const audioInfo = await audioRecorder.processAudioData(data.audio, {
        finalChunk: data.finalChunk || false
      });
      
      // Transcribe audio
      const transcript = await transcriptionService.transcribe(audioInfo.filepath);
      
      // Only proceed if we got meaningful transcription
      if (transcript && transcript.trim().length > 0) {
        socket.emit('transcription', { text: transcript });
        
        // Generate responses with person context
        const personId = socket.data.currentPerson?.id || 'other';
        const result = await llmService.generateResponses(transcript, personId);
        
        socket.emit('responses-generated', { 
          responses: result.responses,
          conversationId: result.conversationId
        });
      } else {
        logger.info('Empty or unclear transcription, skipping response generation');
        
        // If this was a final chunk before stop, still auto-restart recording
        if (data.finalChunk) {
          setTimeout(() => {
            socket.emit('auto-start-recording');
          }, 1000);
        }
      }
      
    } catch (error) {
      logger.error('Failed to process audio:', error);
      socket.emit('error', { message: 'Failed to process audio' });
    }
  });
  
  // Recording status updates
  socket.on('recording-status', (data) => {
    logger.info(`Recording status for ${socket.id}: ${data.status}`);
  });
  
  // Response selection
  socket.on('select-response', async (data) => {
    try {
      const { responseText, conversationId } = data;
      
      // Generate speech
      const audioBuffer = await ttsService.synthesize(responseText);
      socket.emit('tts-audio', { audio: audioBuffer });
      
      // Update conversation with selected response
      await llmService.selectResponse(conversationId, responseText);
      
    } catch (error) {
      logger.error('Failed to process response selection:', error);
      socket.emit('error', { message: 'Failed to process response' });
    }
  });

  // Speak text functionality (NEW)
  socket.on('speak-text', async (data) => {
    try {
      logger.info(`Speak text request: "${data.text.slice(0, 50)}..."`);
      
      // Generate TTS audio
      const audioBase64 = await ttsService.synthesize(data.text);
      
      // Send audio back to client
      socket.emit('speak-audio', {
        audio: audioBase64,
        text: data.text,
        personId: data.personId
      });
      
    } catch (error) {
      logger.error('Speak text error:', error);
      socket.emit('speak-error', {
        message: error.message || 'Failed to synthesize speech'
      });
    }
  });
  
  // Manual text input
  socket.on('text-input', async (data) => {
    try {
      const { text } = data;
      const personId = socket.data.currentPerson?.id || 'other';
      
      // Generate responses
      const result = await llmService.generateResponses(text, personId);
      
      socket.emit('responses-generated', { 
        responses: result.responses,
        conversationId: result.conversationId
      });
      
    } catch (error) {
      logger.error('Failed to process text input:', error);
      socket.emit('error', { message: 'Failed to process text input' });
    }
  });
  
  // Handle client disconnect
  socket.on('disconnect', async () => {
    logger.info('Client disconnected:', socket.id);
    
    // Clean up any ongoing recordings for this socket
    try {
      if (audioRecorder && audioRecorder.handleSocketDisconnect) {
        await audioRecorder.handleSocketDisconnect(socket.id);
      }
    } catch (error) {
      logger.error('Failed to cleanup recording on disconnect:', error);
    }
  });
});

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 5000;

initializeServices().then(() => {
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  
  if (audioRecorder) {
    await audioRecorder.cleanup();
  }
  
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

module.exports = { io };