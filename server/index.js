process.removeAllListeners('warning');
process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
        return; // Ignore punycode deprecation
    }
    console.warn(warning.stack || warning);
});
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { performance } = require('perf_hooks');

const config = require('./config');

// Validate environment variables after dotenv is loaded
config.validateEnvironmentVariables();
const { initializeRAG } = require('./services/rag');
const { startFileWatcher } = require('./utils/fileIndexer');
const logger = require('./utils/logger');
const dataStore = require('./utils/simpleDataStore');
const sessionQueueManager = require('./utils/sessionQueueManager');
const { getTimingLogger } = require('./utils/timingLogger');

// Import routes
const conversationRoutes = require('./routes/conversation');
const settingsRoutes = require('./routes/settings');
const peopleRoutes = require('./routes/people');
const filesRoutes = require('./routes/files');
const memoriesRoutes = require('./routes/memories');
const urlRoutes = require('./routes/urls');

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
  },
  // Add ping timeout settings to prevent connection issues
  pingTimeout: 300000,
  pingInterval: 60000
});

// Add socket.io instance to app.locals so routes can access it
app.locals.io = io;

// Middleware
app.use('/assets', express.static(path.join(__dirname, '../client/assets')));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Routes
app.use('/api/conversation', conversationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/people', peopleRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/memories', memoriesRoutes);
app.use('/api/urls', urlRoutes);

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Initialize services - declare them outside to ensure they're accessible
let audioRecorder = null;
let transcriptionService = null;
let llmService = null;
let ttsService = null;
let isShuttingDown = false;

// Memory usage monitoring
let memoryCheckInterval = null;
let timingLogger = null;

function checkMemoryUsage() {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const rssMB = Math.round(used.rss / 1024 / 1024);
  
  
  // Warn if memory usage is high
  if (heapUsedMB > 500) {
    logger.warn(`High memory usage detected: ${heapUsedMB} MB`);
    
    // Force garbage collection if available
    if (global.gc) {
      logger.info('Running garbage collection...');
      global.gc();
    }
  }
}

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
    global.llmService = llmService; // Make it globally accessible
    ttsService = new TTSService();
    llmService.setSocketIO(io);
    global.llmService = llmService;
    const servicesEndTime = performance.now();
    logger.info(`Services initialization: ${(servicesEndTime - servicesStartTime).toFixed(2)}ms`);
 
    logger.info('✅ All services initialized successfully');
    
    // Start periodic cleanup
    setInterval(() => {
      try {
        if (llmService && typeof llmService.cleanupSessions === 'function') {
          llmService.cleanupSessions();
        }
      } catch (error) {
        logger.error('Error during periodic cleanup:', error);
      }
    }, 10 * 60 * 1000); // Every 10 minutes
    
    // Start memory monitoring
    memoryCheckInterval = setInterval(checkMemoryUsage, 60 * 1000); // Every minute
    
    timingLogger = getTimingLogger();

  } catch (error) {
    logger.error('❌ Failed to initialize services:', error);
    process.exit(1);
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  try {
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

    socket.on('get-settings', async () => {
        try {
            const settings = await dataStore.getSettings();
            socket.emit('settings-updated', settings);
        } catch (error) {
            logger.error('Failed to get settings:', error);
            socket.emit('error', 'Failed to retrieve settings');
        }
    });
    
    // Recording controls
    socket.on('start-recording', async () => {
      try {
        if (audioRecorder) {
          await audioRecorder.startRecording(socket.id);
          socket.emit('recording-started');
        } else {
          throw new Error('Audio recorder not initialized');
        }
      } catch (error) {
        logger.error('Failed to start recording:', error);
        socket.emit('error', { message: 'Failed to start recording' });
      }
    });
    
    socket.on('stop-recording', async () => {
      try {
        if (audioRecorder) {
          await audioRecorder.stopRecording(socket.id);
          socket.emit('recording-stopped');
        }
      } catch (error) {
        logger.error('Failed to stop recording:', error);
        socket.emit('error', { message: 'Failed to stop recording' });
      }
    });
    
    // Process audio from client - WITH TIMING ADDED
    socket.on('audio-data', async (data) => {
        const pipelineStartTime = performance.now();
        
        try {
            // Check if we're shutting down
            if (isShuttingDown) {
                logger.warn('Ignoring audio data during shutdown');
                return;
            }
            
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
            if (transcript && transcript.trim().length > 10) {
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
                    
                    // Break down auxiliary services
                    const ragTime = llmResult.timings?.ragLookup || 0;
                    const chatHistoryTime = llmResult.timings?.chatHistorySearch || 0;
                    const llmApiTime = llmResult.timings?.llmApi || 0;
                    const otherAuxTime = llmResult.timings ? 
                        Object.entries(llmResult.timings)
                            .filter(([key]) => !['llmApi', 'ragLookup', 'chatHistorySearch'].includes(key))
                            .reduce((sum, [, value]) => sum + value, 0) : 0;
                    const totalAuxTime = ragTime + chatHistoryTime + otherAuxTime;
                    const settings = await dataStore.getSettings();
                    
                    logger.info(`🚀 PIPELINE TIMING:
├─ Total: ${totalTime.toFixed(2)}ms
├─ Audio processing: ${audioTime.toFixed(2)}ms (${((audioTime/totalTime)*100).toFixed(1)}%)
├─ Transcription: ${transcriptionTime.toFixed(2)}ms (${((transcriptionTime/totalTime)*100).toFixed(1)}%)
└─ LLM processing: ${llmTotalTime.toFixed(2)}ms (${((llmTotalTime/totalTime)*100).toFixed(1)}%)
   ├─ LLM API call: ${llmApiTime.toFixed(2)}ms (${(llmApiTime/llmTotalTime*100).toFixed(1)}% of LLM time)
   └─ Auxiliary services: ${totalAuxTime.toFixed(2)}ms (${(totalAuxTime/llmTotalTime*100).toFixed(1)}% of LLM time)
      ├─ RAG lookup: ${ragTime.toFixed(2)}ms
      ├─ Chat history: ${chatHistoryTime.toFixed(2)}ms
      └─ Other services: ${otherAuxTime.toFixed(2)}ms`);
                    await timingLogger.logTiming({
                        total: totalTime,
                        audio: audioTime,
                        transcription: transcriptionTime,
                        llmTotal: llmTotalTime,
                        llmApi: llmApiTime,
                        rag: ragTime,
                        chatHistory: chatHistoryTime,
                        otherAux: otherAuxTime,
                        messageType: 'audio',
                        llmModel: llmResult.llmModel || 'unknown',
                        internetSearch: settings?.internetSearch?.enabled !== false,
                        prompt: transcript,
                        selectedResponse: ''
                        
                    });
                    // Detailed LLM breakdown if timings are available
                    if (llmResult.timings) {
                        logger.info(`   📊 Detailed Service Breakdown:
      ├─ Person lookup: ${llmResult.timings.personLookup.toFixed(2)}ms
      ├─ Recent context: ${llmResult.timings.recentContext.toFixed(2)}ms
      ├─ Session context: ${llmResult.timings.sessionContext.toFixed(2)}ms
      ├─ RAG lookup: ${llmResult.timings.ragLookup.toFixed(2)}ms
      ├─ Chat history search: ${llmResult.timings.chatHistorySearch.toFixed(2)}ms
      ├─ Person context: ${(llmResult.timings.personContext || 0).toFixed(2)}ms
      ├─ Message building: ${llmResult.timings.messageBuilding.toFixed(2)}ms
      ├─ LLM API call: ${llmResult.timings.llmApi.toFixed(2)}ms
      ├─ Response parsing: ${llmResult.timings.responseParsing.toFixed(2)}ms
      └─ Chat history save: ${llmResult.timings.chatHistorySave.toFixed(2)}ms`);
                    }
                    
                } else {
                    logger.info('Transcript was duplicate, responses not generated');
                }
                
            } else {
                // Log why we're skipping this transcript
                const trimmedTranscript = transcript ? transcript.trim() : '';
                if (trimmedTranscript.length > 0) {
                    logger.info(`Transcript too short (${trimmedTranscript.length} chars): "${trimmedTranscript}" - ignoring as noise`);
                } else {
                    logger.info('Empty or unclear transcription, skipping response generation');
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
        const { responseText, conversationId, useStreaming = true } = data; // Add streaming flag
        
        let ttsStartTime, ttsEndTime;
        
        // Check if we should use streaming (can be disabled via client)
        if (useStreaming) {
          // STREAMING MODE
          ttsStartTime = performance.now();
          
          try {
            // Get the audio stream from ElevenLabs
            const audioStream = await ttsService.streamSynthesis(responseText);
            
            // Stream chunks to client as they arrive
            let chunkCount = 0;
            let totalBytes = 0;
            
            for await (const chunk of audioStream) {
              // Convert chunk to base64 and emit
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              const b64Chunk = buffer.toString('base64');
              socket.emit('tts-audio-chunk', { 
                audio: b64Chunk,
                chunkIndex: chunkCount++
              });
              totalBytes += chunk.length;
              
              // Log first chunk timing for perceived latency
              if (chunkCount === 1) {
                const firstChunkTime = performance.now();
                logger.info(`🎵 First audio chunk sent after ${(firstChunkTime - ttsStartTime).toFixed(2)}ms`);
              }
            }
            
            // Signal end of stream
            socket.emit('tts-audio-end', { 
              totalChunks: chunkCount,
              totalBytes: totalBytes 
            });
            
            ttsEndTime = performance.now();
            logger.info(`🎵 TTS streaming completed: ${chunkCount} chunks, ${totalBytes} bytes in ${(ttsEndTime - ttsStartTime).toFixed(2)}ms`);
            
          } catch (streamError) {
            logger.error('TTS streaming failed, falling back to buffered mode:', streamError);
            
            // FALLBACK TO BUFFERED MODE
            const fallbackStartTime = performance.now();
            const audioBuffer = await ttsService.synthesize(responseText);
            ttsEndTime = performance.now();
            
            socket.emit('tts-audio', { audio: audioBuffer });
            logger.info(`🎵 TTS fallback buffered synthesis: ${(ttsEndTime - fallbackStartTime).toFixed(2)}ms`);
          }
          
        } else {
          // BUFFERED MODE (original implementation)
          ttsStartTime = performance.now();
          const audioBuffer = await ttsService.synthesize(responseText);
          ttsEndTime = performance.now();
          
          socket.emit('tts-audio', { audio: audioBuffer });
          logger.info(`🎵 TTS buffered synthesis: ${(ttsEndTime - ttsStartTime).toFixed(2)}ms`);
        }
        
        // Update conversation with selected response (same for both modes)
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

    // Regenerate responses
    socket.on('regenerate-responses', async (data) => {
        const startTime = performance.now();
        
        try {
            if (isShuttingDown) {
                logger.warn('Ignoring regenerate request during shutdown');
                return;
            }
            
            const { text, conversationId } = data;
            const personId = socket.data.currentPerson?.id || 'other';
            
            logger.info(`Regenerating responses for: "${text.slice(0, 50)}..."`);
            
            // Generate new responses
            const llmStartTime = performance.now();
            const result = await llmService.generateResponses(text, personId, socket.id);
            const llmEndTime = performance.now();
            
            // Update the last context with new conversation ID
            socket.data.lastContext = {
                userMessage: text,
                personName: result.personName,
                personNotes: result.personNotes,
                conversationId: result.conversationId
            };
            
            // Send new responses to client
            socket.emit('responses-generated', { 
                responses: result.responses,
                conversationId: result.conversationId,
                userMessage: text,
                personName: result.personName,
                personNotes: result.personNotes
            });
            
            // COMPREHENSIVE TIMING BREAKDOWN
            const totalTime = performance.now() - startTime;
            const llmTime = llmEndTime - llmStartTime;
            
            // Break down auxiliary services
            if (result.timings) {
                const ragTime = result.timings.ragLookup || 0;
                const chatHistoryTime = result.timings.chatHistorySearch || 0;
                const llmApiTime = result.timings.llmApi || 0;
                const otherAuxTime = Object.entries(result.timings)
                    .filter(([key]) => !['llmApi', 'ragLookup', 'chatHistorySearch'].includes(key))
                    .reduce((sum, [, value]) => sum + value, 0);
                const totalAuxTime = ragTime + chatHistoryTime + otherAuxTime;
                const settings = await dataStore.getSettings();
                
                logger.info(`🔄 Regenerate responses:
├─ Total: ${totalTime.toFixed(2)}ms
└─ LLM processing: ${llmTime.toFixed(2)}ms
   ├─ LLM API call: ${llmApiTime.toFixed(2)}ms (${(llmApiTime/llmTime*100).toFixed(1)}%)
   └─ Auxiliary services: ${totalAuxTime.toFixed(2)}ms (${(totalAuxTime/llmTime*100).toFixed(1)}%)
      ├─ RAG lookup: ${ragTime.toFixed(2)}ms
      ├─ Chat history: ${chatHistoryTime.toFixed(2)}ms
      └─ Other services: ${otherAuxTime.toFixed(2)}ms`);
                await timingLogger.logTiming({
                    total: totalTime,
                    llmTotal: llmTime,
                    llmApi: llmApiTime,
                    rag: ragTime,
                    chatHistory: chatHistoryTime,
                    otherAux: otherAuxTime,
                    messageType: 'regenerate',
                    llmModel: result.llmModel || 'unknown',
                    internetSearch: settings?.internetSearch?.enabled !== false,
                    prompt: text,
                    selectedResponse: ''
                });
                
                // Optional: Detailed breakdown
                logger.info(`   📊 Detailed Service Breakdown:
      ├─ Person lookup: ${result.timings.personLookup.toFixed(2)}ms
      ├─ Recent context: ${result.timings.recentContext.toFixed(2)}ms
      ├─ Session context: ${result.timings.sessionContext.toFixed(2)}ms
      ├─ RAG lookup: ${result.timings.ragLookup.toFixed(2)}ms
      ├─ Chat history search: ${result.timings.chatHistorySearch.toFixed(2)}ms
      ├─ Person context: ${(result.timings.personContext || 0).toFixed(2)}ms
      ├─ Message building: ${result.timings.messageBuilding.toFixed(2)}ms
      ├─ LLM API call: ${result.timings.llmApi.toFixed(2)}ms
      ├─ Response parsing: ${result.timings.responseParsing.toFixed(2)}ms
      └─ Chat history save: ${result.timings.chatHistorySave.toFixed(2)}ms`);
            } else {
                logger.info(`🔄 Regenerate responses: ${totalTime.toFixed(2)}ms (no detailed timings)`);
            }
            
        } catch (error) {
            const endTime = performance.now();
            logger.error(`Failed to regenerate responses after ${(endTime - startTime).toFixed(2)}ms:`, error);
            socket.emit('error', { message: 'Failed to regenerate responses' });
        }
    });
    
    // Manual text input - WITH TIMING ADDED
    socket.on('text-input', async (data) => {
        const startTime = performance.now();
        
        try {
            if (isShuttingDown) {
                logger.warn('Ignoring text input during shutdown');
                return;
            }
            
            const { text } = data;
            const personId = socket.data.currentPerson?.id || 'other';
            
            // Add transcript to session queue with deduplication
            const addedToQueue = sessionQueueManager.addTranscript(socket.id, text);
            
            if (addedToQueue) {
                // Clean up old unresponded transcripts
                sessionQueueManager.cleanupOldTranscripts(socket.id);
                
                // Generate responses
                const llmStartTime = performance.now();
                const result = await llmService.generateResponses(text, personId, socket.id); // Pass socket ID
                const llmEndTime = performance.now();
                
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
                
                // COMPREHENSIVE TIMING BREAKDOWN
                const totalTime = performance.now() - startTime;
                const llmTime = llmEndTime - llmStartTime;
                
                // Break down auxiliary services
                if (result.timings) {
                    const ragTime = result.timings.ragLookup || 0;
                    const chatHistoryTime = result.timings.chatHistorySearch || 0;
                    const llmApiTime = result.timings.llmApi || 0;
                    const otherAuxTime = Object.entries(result.timings)
                        .filter(([key]) => !['llmApi', 'ragLookup', 'chatHistorySearch'].includes(key))
                        .reduce((sum, [, value]) => sum + value, 0);
                    const totalAuxTime = ragTime + chatHistoryTime + otherAuxTime;
                    const settings = await dataStore.getSettings();
                    
                    logger.info(`📝 Text input processing:
├─ Total: ${totalTime.toFixed(2)}ms
└─ LLM processing: ${llmTime.toFixed(2)}ms
   ├─ LLM API call: ${llmApiTime.toFixed(2)}ms (${(llmApiTime/llmTime*100).toFixed(1)}%)
   └─ Auxiliary services: ${totalAuxTime.toFixed(2)}ms (${(totalAuxTime/llmTime*100).toFixed(1)}%)
      ├─ RAG lookup: ${ragTime.toFixed(2)}ms
      ├─ Chat history: ${chatHistoryTime.toFixed(2)}ms
      └─ Other services: ${otherAuxTime.toFixed(2)}ms`);

                    await timingLogger.logTiming({
                        total: totalTime,
                        audio: 0,
                        transcription: 0,
                        llmTotal: llmTime,
                        llmApi: llmApiTime,
                        rag: ragTime,
                        chatHistory: chatHistoryTime,
                        otherAux: otherAuxTime,
                        messageType: 'text',
                        llmModel: result.llmModel || 'unknown',
                        internetSearch: settings?.internetSearch?.enabled !== false,
                        prompt: text,
                        selectedResponse: ''
                    });
                    // Optional: Detailed breakdown
                    logger.info(`   📊 Detailed Service Breakdown:
      ├─ Person lookup: ${result.timings.personLookup.toFixed(2)}ms
      ├─ Recent context: ${result.timings.recentContext.toFixed(2)}ms
      ├─ Session context: ${result.timings.sessionContext.toFixed(2)}ms
      ├─ RAG lookup: ${result.timings.ragLookup.toFixed(2)}ms
      ├─ Chat history search: ${result.timings.chatHistorySearch.toFixed(2)}ms
      ├─ Person context: ${(result.timings.personContext || 0).toFixed(2)}ms
      ├─ Message building: ${result.timings.messageBuilding.toFixed(2)}ms
      ├─ LLM API call: ${result.timings.llmApi.toFixed(2)}ms
      ├─ Response parsing: ${result.timings.responseParsing.toFixed(2)}ms
      └─ Chat history save: ${result.timings.chatHistorySave.toFixed(2)}ms`);
                } else {
                    logger.info(`📝 Text input processing: ${totalTime.toFixed(2)}ms (no detailed timings)`);
                }
            } else {
                logger.info('Text input was duplicate, responses not generated');
            }
            
        } catch (error) {
            const endTime = performance.now();
            logger.error(`Failed to process text input after ${(endTime - startTime).toFixed(2)}ms:`, error);
            socket.emit('error', { message: 'Failed to process text input' });
        }
    });
    
    // Handle client disconnect
    socket.on('disconnect', async () => {
      logger.info('Client disconnected:', socket.id);
      
      try {
        // Clean up session queues
        sessionQueueManager.cleanupSocket(socket.id);
        
        // Clean up any ongoing recordings for this socket
        if (audioRecorder && typeof audioRecorder.handleSocketDisconnect === 'function') {
          await audioRecorder.handleSocketDisconnect(socket.id);
        }
      } catch (error) {
        logger.error('Failed to cleanup on disconnect:', error);
      }
    });
    
  } catch (error) {
    logger.error('Error in socket connection handler:', error);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Give the logger time to write
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit on unhandled rejections, just log them
});

// Start server
const PORT = config.port || 5050;

initializeServices().then(() => {
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${config.env}`);
    logger.info(`Memory monitoring enabled`);
  });
}).catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});

// Graceful shutdown handling
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    logger.info('Shutdown already in progress...');
    return;
  }
  
  isShuttingDown = true;
  logger.info(`${signal} received. Starting graceful shutdown...`);
  
  // Clear intervals
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
  }
  
  // Close server to stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Close all socket connections
  io.close(() => {
    logger.info('Socket.io connections closed');
  });
  
  // Cleanup services
  try {
    if (audioRecorder && typeof audioRecorder.cleanup === 'function') {
      logger.info('Cleaning up audio recorder...');
      await audioRecorder.cleanup();
    }
  } catch (error) {
    logger.error('Error cleaning up audio recorder:', error);
  }
  
  // Give everything time to finish
  setTimeout(() => {
    logger.info('Shutdown complete');
    process.exit(0);
  }, 1000);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// For Windows
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Export for potential external use
module.exports = { app, io, server };