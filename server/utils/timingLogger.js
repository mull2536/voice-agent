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
                // Updated headers to include internetSearch, prompt, and selectedResponse
                const headers = 'timestamp,total_ms,audio_ms,transcription_ms,llm_total_ms,llm_api_ms,rag_ms,chat_history_ms,other_aux_ms,message_type,llm_model,internet_search_enabled,prompt,selected_response\n';
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
                total = 0,
                audio = 0,
                transcription = 0,
                llmTotal = 0,
                llmApi = 0,
                rag = 0,
                chatHistory = 0,
                otherAux = 0,
                messageType = 'audio',
                llmModel = 'unknown',
                internetSearch = false,
                prompt = '',
                selectedResponse = ''
            } = timingData;

            const timestamp = new Date().toISOString();
            
            // Safely convert all numeric values to fixed decimal places
            const formatValue = (val) => {
                const num = parseFloat(val) || 0;
                return num.toFixed(2);
            };
            
            // Escape CSV fields that might contain commas or quotes
            const escapeCSV = (str) => {
                if (!str) return '';
                const stringValue = String(str);
                // If contains comma, newline, or quote, wrap in quotes and escape internal quotes
                if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
                    return `"${stringValue.replace(/"/g, '""')}"`;
                }
                return stringValue;
            };
            
            const csvLine = `${timestamp},${formatValue(total)},${formatValue(audio)},${formatValue(transcription)},${formatValue(llmTotal)},${formatValue(llmApi)},${formatValue(rag)},${formatValue(chatHistory)},${formatValue(otherAux)},${messageType},${llmModel},${internetSearch},${escapeCSV(prompt)},${escapeCSV(selectedResponse)}\n`;
            
            await fs.appendFile(this.csvPath, csvLine);
            logger.info(`Timing logged: ${messageType} - Total: ${formatValue(total)}ms - Prompt: "${prompt.substring(0, 50)}..."`);
        } catch (error) {
            logger.error('Failed to write timing log:', error);
            logger.error('Timing data that caused error:', JSON.stringify(timingData, null, 2));
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