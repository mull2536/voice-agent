// server/utils/timingLogger.js
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class TimingLogger {
    constructor() {
        this.csvPath = path.join(__dirname, '../../data/logs/timing_logs.csv');
        logger.info(`Timing logger CSV path: ${this.csvPath}`);
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
                logger.info('Timing logs CSV file already exists');
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
            const csvLine = `${timestamp},${total.toFixed(2)},${audio.toFixed(2)},${transcription.toFixed(2)},${llmTotal.toFixed(2)},${llmApi.toFixed(2)},${rag.toFixed(2)},${chatHistory.toFixed(2)},${otherAux.toFixed(2)},${messageType},${llmModel}\n`;
            
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