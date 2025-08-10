// Update server/utils/timingLogger.js:

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class TimingLogger {
    constructor() {
        this.csvPath = path.join(__dirname, '../../data/logs/timing_logs.csv');
        this.ensureLogFile();
    }

    async ensureLogFile() {
        try {
            // Ensure logs directory exists
            const logsDir = path.dirname(this.csvPath);
            await fs.mkdir(logsDir, { recursive: true });

            // Check if CSV file exists, if not create with headers
            try {
                await fs.access(this.csvPath);
            } catch {
                const headers = 'timestamp,total_ms,audio_ms,transcription_ms,llm_total_ms,llm_api_ms,rag_ms,chat_history_ms,other_aux_ms,message_type,llm_model\n';
                await fs.writeFile(this.csvPath, headers);
                logger.info('Created timing logs CSV file with headers');
            }
        } catch (error) {
            logger.error('Failed to ensure timing log file:', error);
        }
    }

    async logTiming(timingData) {
        try {
            const {
                total,
                audio,
                transcription,
                llmTotal,
                llmApi,
                rag,
                chatHistory,
                otherAux,
                messageType = 'audio',
                llmModel = 'unknown'
            } = timingData;

            const timestamp = new Date().toISOString();
            const csvLine = `${timestamp},${total},${audio},${transcription},${llmTotal},${llmApi},${rag},${chatHistory},${otherAux},${messageType},${llmModel}\n`;
            
            await fs.appendFile(this.csvPath, csvLine);
        } catch (error) {
            logger.error('Failed to write timing log:', error);
        }
    }

    async getLogPath() {
        return this.csvPath;
    }
}

// Singleton instance
let timingLogger = null;

function getTimingLogger() {
    if (!timingLogger) {
        timingLogger = new TimingLogger();
    }
    return timingLogger;
}

module.exports = { getTimingLogger };

// In server/services/llm.js, modify generateResponses to return the model used:
// In the return object, add the model:
return {
    responses: responses,
    conversationId: conversationId,
    personName: person?.name || 'Other',
    personNotes: person?.notes || '',
    timings: timings,
    llmModel: settings?.llm?.model || config.llm.model || 'gpt-4.1-mini'  // ADD THIS LINE
};

// In server/index.js, update all three handlers to include the model:

// 1. For audio-data:
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
    llmModel: llmResult.llmModel || 'unknown'  // ADD THIS
});

// 2. For text-input:
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
    llmModel: result.llmModel || 'unknown'  // ADD THIS
});

// 3. For regenerate-responses:
await timingLogger.logTiming({
    total: totalTime,
    audio: 0,
    transcription: 0,
    llmTotal: llmTime,
    llmApi: llmApiTime,
    rag: ragTime,
    chatHistory: chatHistoryTime,
    otherAux: otherAuxTime,
    messageType: 'regenerate',
    llmModel: result.llmModel || 'unknown'  // ADD THIS
});