// server/utils/sessionQueueManager.js
const logger = require('./logger');

class SessionQueueManager {
    constructor() {
        this.sessionQueues = new Map(); // Map of socketId -> queues
        this.maxConversationItems = 4;
        this.maxTranscriptItems = 4;
        this.transcriptCleanupThreshold = 3; // Clean up after 3 new transcripts
    }

    // Initialize queues for a new socket
    initializeSocket(socketId) {
        this.sessionQueues.set(socketId, {
            conversationQueue: [],
            transcriptQueue: []
        });
        logger.info(`Session queues initialized for socket: ${socketId}`);
    }

    // Clean up queues when socket disconnects
    cleanupSocket(socketId) {
        if (this.sessionQueues.has(socketId)) {
            this.sessionQueues.delete(socketId);
            logger.info(`Session queues cleaned up for socket: ${socketId}`);
        }
    }

    // Get queues for a socket (create if doesn't exist)
    getQueues(socketId) {
        if (!this.sessionQueues.has(socketId)) {
            this.initializeSocket(socketId);
        }
        return this.sessionQueues.get(socketId);
    }

    // Add transcript to transcript queue with deduplication
    addTranscript(socketId, transcript) {
        const queues = this.getQueues(socketId);
        const timestamp = new Date().toISOString();

        // Check for exact text duplicate in conversation queue
        const isDuplicateInConversation = queues.conversationQueue.some(
            exchange => exchange.user === transcript
        );

        // Check for exact text duplicate in transcript queue
        const isDuplicateInTranscripts = queues.transcriptQueue.some(
            item => item.text === transcript
        );

        if (isDuplicateInConversation || isDuplicateInTranscripts) {
            logger.info(`Duplicate transcript skipped: "${transcript.slice(0, 30)}..."`);
            return false; // Duplicate found, not added
        }

        // Add to transcript queue
        queues.transcriptQueue.push({
            text: transcript,
            timestamp: timestamp,
            responded: false
        });

        // Cleanup old transcripts (keep only last maxTranscriptItems)
        if (queues.transcriptQueue.length > this.maxTranscriptItems) {
            const removed = queues.transcriptQueue.shift();
            logger.info(`Old transcript removed from queue: "${removed.text.slice(0, 30)}..."`);
        }

        logger.info(`Transcript added to queue. Queue size: ${queues.transcriptQueue.length}`);
        return true; // Successfully added
    }

    // Add complete exchange to conversation queue and remove from transcript queue
    addConversationExchange(socketId, userMessage, assistantResponse) {
        const queues = this.getQueues(socketId);
        const timestamp = new Date().toISOString();

        // Add to conversation queue
        queues.conversationQueue.push({
            user: userMessage,
            assistant: assistantResponse,
            timestamp: timestamp
        });

        // Remove from conversation queue if exceeds limit (FIFO)
        if (queues.conversationQueue.length > this.maxConversationItems) {
            const removed = queues.conversationQueue.shift();
            logger.info(`Old conversation removed from queue: "${removed.user.slice(0, 30)}..."`);
        }

        // Find and remove corresponding transcript from transcript queue
        const transcriptIndex = queues.transcriptQueue.findIndex(
            item => item.text === userMessage
        );

        if (transcriptIndex !== -1) {
            const removedTranscript = queues.transcriptQueue.splice(transcriptIndex, 1)[0];
            logger.info(`Transcript moved to conversation queue: "${removedTranscript.text.slice(0, 30)}..."`);
        }

        logger.info(`Conversation exchange added. Conv queue: ${queues.conversationQueue.length}, Transcript queue: ${queues.transcriptQueue.length}`);
    }

    // Get unresponded transcripts
    getUnrespondedTranscripts(socketId) {
        const queues = this.getQueues(socketId);
        return queues.transcriptQueue.filter(item => !item.responded);
    }

    // Get recent conversation exchanges
    getConversationExchanges(socketId) {
        const queues = this.getQueues(socketId);
        return queues.conversationQueue;
    }

    // Build context string for LLM
    buildSessionContext(socketId) {
        const queues = this.getQueues(socketId);
        let context = '';

        // Add conversation queue (complete exchanges)
        if (queues.conversationQueue.length > 0) {
            context += 'Recent conversation:\n';
            queues.conversationQueue.forEach(exchange => {
                context += `User: ${exchange.user}\n`;
                context += `Assistant: ${exchange.assistant}\n`;
            });
            context += '\n';
        }

        // Add unresponded transcripts
        const unresponded = queues.transcriptQueue.filter(item => !item.responded);
        if (unresponded.length > 0) {
            context += 'Unresponded messages:\n';
            unresponded.forEach(item => {
                context += `User: ${item.text}\n`;
            });
            context += '\n';
        }

        return context.trim();
    }

    // Get queue status for debugging
    getQueueStatus(socketId) {
        const queues = this.getQueues(socketId);
        return {
            conversationCount: queues.conversationQueue.length,
            transcriptCount: queues.transcriptQueue.length,
            unrespondedCount: queues.transcriptQueue.filter(item => !item.responded).length
        };
    }

    // Clean up old unresponded transcripts (after 3 new ones)
    cleanupOldTranscripts(socketId) {
        const queues = this.getQueues(socketId);
        const unresponded = queues.transcriptQueue.filter(item => !item.responded);
        
        if (unresponded.length > this.transcriptCleanupThreshold) {
            // Remove oldest unresponded transcripts
            const toRemove = unresponded.length - this.transcriptCleanupThreshold;
            for (let i = 0; i < toRemove; i++) {
                const oldestIndex = queues.transcriptQueue.findIndex(item => !item.responded);
                if (oldestIndex !== -1) {
                    const removed = queues.transcriptQueue.splice(oldestIndex, 1)[0];
                    logger.info(`Old unresponded transcript cleaned up: "${removed.text.slice(0, 30)}..."`);
                }
            }
        }
    }

    // Get all session IDs (for debugging/monitoring)
    getAllSessionIds() {
        return Array.from(this.sessionQueues.keys());
    }

    // Get total session count
    getSessionCount() {
        return this.sessionQueues.size;
    }
}

// Singleton instance
const sessionQueueManager = new SessionQueueManager();

module.exports = sessionQueueManager;