require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { performance } = require('perf_hooks');

const config = require('./config');
const { initializeRAG } = require('./services/rag');
const { startFileWatcher } = require('./utils/fileIndexer');
const logger = require('./utils/logger');
const dataStore = require('./utils/simpleDataStore');
const sessionQueueManager = require('./utils/sessionQueueManager');

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
    logger.info('🚀 Initializing services...');
    
    // Initialize RAG system
    const ragStartTime = performance.now();
    await initializeRAG();
    const ragEndTime = performance.now();
    logger.info(`RAG initialization: ${(ragEndTime - ragStartTime).toFixed(2)}ms`);
    
    // Start file watcher for knowledge base
    const watcherStartTime = performance.now();
    startFileWatcher();
    const watcherEndTime = performance.now();
    logger.info(`File watcher initialization: ${(watcherEndTime - watcherStartTime).toFixed(2)}ms`);
    
    // Initialize services
    const servicesStartTime = performance.now();
    audioRecorder = new AudioRecorder(io);
    transcriptionService = new TranscriptionService();
    llmService = new LLMService();
    ttsService = new TTSService();
    const servicesEndTime = performance.now();
    logger.info(`Services initialization: ${(servicesEndTime - servicesStartTime).toFixed(2)}ms`);
 
    logger.info('✅ All services initialized successfully');
    
    // Start periodic cleanup
    setInterval(() => {
      if (llmService && typeof llmService.cleanupSessions === 'function') {
        llmService.cleanupSessions();
      }
    }, 10 * 60 * 1000); // Every 10 minutes
    
  } catch (error) {
    logger.error('❌ Failed to initialize services:', error);
    process.exit(1);
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info('Client connected:', socket.id);
  
  sessionQueueManager.initializeSocket(socket.id);
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
  
  // Process audio from client - WITH TIMING ADDED
 socket.on('audio-data', async (data) => {
  const pipelineStartTime = performance.now();
  
  try {
    // 1. AUDIO PROCESSING
    const audioStartTime = performance.now();
    const audioInfo = await audioRecorder.processAudioData(data.audio, {
      finalChunk: data.finalChunk || false
    });
    const audioEndTime = performance.now();
    
    // 2. TRANSCRIPTION
    const transcriptionStartTime = performance.now();
    const transcript = await transcriptionService.transcribe(audioInfo.filepath);
    const transcriptionEndTime = performance.now();
    
    // Only proceed if we got meaningful transcription
    if (transcript && transcript.trim().length > 0) {
      socket.emit('transcription', { text: transcript });
      
      // Add transcript to session queue with deduplication
      const addedToQueue = sessionQueueManager.addTranscript(socket.id, transcript);
      let llmResult = null;
      
      if (addedToQueue) {
        // Clean up old unresponded transcripts
        sessionQueueManager.cleanupOldTranscripts(socket.id);
        
        // 3. LLM PROCESSING WITH DETAILED TIMING
        const llmStartTime = performance.now();
        const personId = socket.data.currentPerson?.id || 'other';
        llmResult = await llmService.generateResponses(transcript, personId, socket.id);
        const llmEndTime = performance.now();
        
        // Store context for later use in response selection
        socket.data.lastContext = {
          userMessage: transcript,
          personName: llmResult.personName,
          personNotes: llmResult.personNotes,
          conversationId: llmResult.conversationId
        };
        
        socket.emit('responses-generated', { 
          responses: llmResult.responses,
          conversationId: llmResult.conversationId,
          userMessage: transcript,
          personName: llmResult.personName,
          personNotes: llmResult.personNotes
        });
        
        // Log queue status
        const queueStatus = sessionQueueManager.getQueueStatus(socket.id);
        logger.info(`Queue status - Conv: ${queueStatus.conversationCount}, Transcripts: ${queueStatus.transcriptCount}, Unresponded: ${queueStatus.unrespondedCount}`);
        
        // COMPREHENSIVE TIMING BREAKDOWN
        const pipelineEndTime = performance.now();
        const totalTime = pipelineEndTime - pipelineStartTime;
        const audioTime = audioEndTime - audioStartTime;
        const transcriptionTime = transcriptionEndTime - transcriptionStartTime;
        const llmTotalTime = llmEndTime - llmStartTime;
        
        // Calculate auxiliary time (everything except LLM API call)
        const auxiliaryTime = llmResult.timings ? 
          Object.entries(llmResult.timings)
            .filter(([key]) => key !== 'llmApi')
            .reduce((sum, [, value]) => sum + value, 0) : 0;
        
        logger.info(`🚀 PIPELINE TIMING:
├─ Total: ${totalTime.toFixed(2)}ms
├─ Audio processing: ${audioTime.toFixed(2)}ms (${((audioTime/totalTime)*100).toFixed(1)}%)
├─ Transcription: ${transcriptionTime.toFixed(2)}ms (${((transcriptionTime/totalTime)*100).toFixed(1)}%)
└─ LLM processing: ${llmTotalTime.toFixed(2)}ms (${((llmTotalTime/totalTime)*100).toFixed(1)}%)
   ├─ LLM API call: ${(llmResult.timings?.llmApi || 0).toFixed(2)}ms (${((llmResult.timings?.llmApi || 0)/llmTotalTime*100).toFixed(1)}% of LLM time)
   └─ Auxiliary services: ${auxiliaryTime.toFixed(2)}ms (${(auxiliaryTime/llmTotalTime*100).toFixed(1)}% of LLM time)`);
        
        // Detailed LLM breakdown if timings are available
        if (llmResult.timings) {
          logger.info(`   📊 LLM Service Breakdown:
      ├─ Person lookup: ${llmResult.timings.personLookup.toFixed(2)}ms
      ├─ Recent context: ${llmResult.timings.recentContext.toFixed(2)}ms
      ├─ Session context: ${llmResult.timings.sessionContext.toFixed(2)}ms
      ├─ RAG lookup: ${llmResult.timings.ragLookup.toFixed(2)}ms
      ├─ Chat history search: ${llmResult.timings.chatHistorySearch.toFixed(2)}ms
      ├─ Message building: ${llmResult.timings.messageBuilding.toFixed(2)}ms
      ├─ Response parsing: ${llmResult.timings.responseParsing.toFixed(2)}ms
      └─ Chat history save: ${llmResult.timings.chatHistorySave.toFixed(2)}ms`);
        }
        
      } else {
        logger.info('Transcript was duplicate, responses not generated');
      }
      
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
    const pipelineEndTime = performance.now();
    logger.error(`❌ Pipeline failed after ${(pipelineEndTime - pipelineStartTime).toFixed(2)}ms:`, error);
    socket.emit('error', { message: 'Failed to process audio' });
  }
});
  
  // Recording status updates
  socket.on('recording-status', (data) => {
    logger.info(`Recording status for ${socket.id}: ${data.status}`);
  });
  
  // Response selection - WITH TIMING ADDED
  socket.on('select-response', async (data) => {
    const startTime = performance.now();
    
    try {
      const { responseText, conversationId } = data;
      
      // Generate speech
      const ttsStartTime = performance.now();
      const audioBuffer = await ttsService.synthesize(responseText);
      const ttsEndTime = performance.now();
      
      socket.emit('tts-audio', { audio: audioBuffer });
      
      // Update conversation with selected response
      const saveStartTime = performance.now();
      await llmService.selectResponse(conversationId, responseText);
      
      // Add to session conversation queue and remove from transcript queue
      if (socket.data.lastContext) {
        sessionQueueManager.addConversationExchange(
          socket.id,
          socket.data.lastContext.userMessage,
          responseText
        );
        
        // Also save complete exchange to chat history
        if (socket.data.currentPerson) {
          try {
            await llmService.chatHistoryService.saveConversation(
              socket.data.currentPerson.id || 'other',
              socket.data.currentPerson.name,
              socket.data.currentPerson.notes || '',
              socket.data.lastContext.userMessage,
              responseText
            );
            logger.info('Complete chat exchange saved successfully');
          } catch (chatError) {
            logger.error('Failed to save chat exchange:', chatError);
          }
        }
      }
      
      const saveEndTime = performance.now();
      
      // Log queue status after response selection
      const queueStatus = sessionQueueManager.getQueueStatus(socket.id);
      logger.info(`After response selection - Conv: ${queueStatus.conversationCount}, Transcripts: ${queueStatus.transcriptCount}, Unresponded: ${queueStatus.unrespondedCount}`);
      
      // LOG TIMING
      const totalTime = performance.now() - startTime;
      logger.info(`🎤 Response Selection:
  ├─ Total: ${totalTime.toFixed(2)}ms
  ├─ TTS: ${(ttsEndTime - ttsStartTime).toFixed(2)}ms
  └─ Save: ${(saveEndTime - saveStartTime).toFixed(2)}ms`);
      
    } catch (error) {
      logger.error('Failed to process response selection:', error);
      socket.emit('error', { message: 'Failed to process response' });
    }
  });

  // Speak text functionality - WITH TIMING ADDED
  socket.on('speak-text', async (data) => {
    const startTime = performance.now();
    
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
      
      const endTime = performance.now();
      logger.info(`🔊 Speak text: ${(endTime - startTime).toFixed(2)}ms`);
      
    } catch (error) {
      logger.error('Speak text error:', error);
      socket.emit('speak-error', {
        message: error.message || 'Failed to synthesize speech'
      });
    }
  });
  
  
  // Manual text input - WITH TIMING ADDED
 socket.on('text-input', async (data) => {
    const startTime = performance.now();
    
    try {
      const { text } = data;
      const personId = socket.data.currentPerson?.id || 'other';
      
      // Add transcript to session queue with deduplication
      const addedToQueue = sessionQueueManager.addTranscript(socket.id, text);
      
      if (addedToQueue) {
        // Clean up old unresponded transcripts
        sessionQueueManager.cleanupOldTranscripts(socket.id);
        
        // Generate responses
        const result = await llmService.generateResponses(text, personId, socket.id); // Pass socket ID
        
        // Store context for later use in response selection
        socket.data.lastContext = {
          userMessage: text,
          personName: result.personName,
          personNotes: result.personNotes,
          conversationId: result.conversationId
        };
        
        socket.emit('responses-generated', { 
          responses: result.responses,
          conversationId: result.conversationId,
          userMessage: text,
          personName: result.personName,
          personNotes: result.personNotes
        });
        
        // Log queue status
        const queueStatus = sessionQueueManager.getQueueStatus(socket.id);
        logger.info(`Queue status - Conv: ${queueStatus.conversationCount}, Transcripts: ${queueStatus.transcriptCount}, Unresponded: ${queueStatus.unrespondedCount}`);
      } else {
        logger.info('Text input was duplicate, responses not generated');
      }
      
      const endTime = performance.now();
      logger.info(`📝 Text input processing: ${(endTime - startTime).toFixed(2)}ms`);
      
    } catch (error) {
      logger.error('Failed to process text input:', error);
      socket.emit('error', { message: 'Failed to process text input' });
    }
  });
  
  // Handle client disconnect
  socket.on('disconnect', async () => {
    logger.info('Client disconnected:', socket.id);
    
    // Clean up session queues
    sessionQueueManager.cleanupSocket(socket.id);
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
const PORT = process.env.PORT || 5050;

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