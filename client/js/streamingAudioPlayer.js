// client/js/streamingAudioPlayer.js

class StreamingAudioPlayer {
    constructor() {
        this.mediaSource = null;
        this.sourceBuffer = null;
        this.audioElement = null;
        this.pendingChunks = [];
        this.isInitialized = false;
        this.isSourceOpen = false;
        this.isStreamEnding = false;
        this.onCompleteCallback = null;
        this.hasStartedPlayback = false;
        this.totalBytesReceived = 0;
        this.chunkCount = 0;
    }

    /**
     * Initialize the streaming player with an audio element and completion callback
     */
    async initialize(audioElement, onComplete) {
        this.audioElement = audioElement;
        this.onCompleteCallback = onComplete;
        
        // Check for MediaSource support
        if (!window.MediaSource) {
            console.error('MediaSource API not supported');
            throw new Error('Streaming audio not supported in this browser');
        }
        
        try {
            // Create MediaSource
            this.mediaSource = new MediaSource();
            
            // Set up event handlers
            this.mediaSource.addEventListener('sourceopen', () => this.onSourceOpen());
            this.mediaSource.addEventListener('sourceended', () => this.onSourceEnded());
            this.mediaSource.addEventListener('error', (e) => this.onError(e));
            
            // Create object URL and assign to audio element
            const url = URL.createObjectURL(this.mediaSource);
            this.audioElement.src = url;
            
            // Set up audio element event handlers
            this.audioElement.addEventListener('ended', () => this.onPlaybackEnded());
            this.audioElement.addEventListener('error', (e) => this.onPlaybackError(e));
            
            this.isInitialized = true;
            console.log('Streaming audio player initialized');
            
        } catch (error) {
            console.error('Failed to initialize streaming player:', error);
            throw error;
        }
    }

    /**
     * Called when MediaSource is opened and ready
     */
    onSourceOpen() {
        console.log('MediaSource opened');
        
        try {
            // Create source buffer for MP3
            // ElevenLabs returns mp3_44100_192 format
            const mimeType = 'audio/mpeg';
            
            if (!MediaSource.isTypeSupported(mimeType)) {
                throw new Error(`MIME type ${mimeType} not supported`);
            }
            
            this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
            this.sourceBuffer.mode = 'sequence'; // Important for streaming
            
            // Set up source buffer event handlers
            this.sourceBuffer.addEventListener('updateend', () => this.onUpdateEnd());
            this.sourceBuffer.addEventListener('error', (e) => this.onSourceBufferError(e));
            
            this.isSourceOpen = true;
            
            // Process any pending chunks
            this.processPendingChunks();
            
        } catch (error) {
            console.error('Failed to create source buffer:', error);
            this.cleanup();
        }
    }

    /**
     * Append audio chunk to the stream
     */
    appendChunk(base64Chunk) {
        try {
            // Validate base64 string
            if (!base64Chunk || typeof base64Chunk !== 'string') {
                console.error('Invalid chunk: not a string', typeof base64Chunk);
                return;
            }
            
            // Remove any whitespace that might have been added
            const cleanBase64 = base64Chunk.replace(/\s/g, '');
            
            // Validate base64 format
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64)) {
                console.error('Invalid base64 format');
                return;
            }
            
            // Convert base64 to Uint8Array
            const binaryString = atob(cleanBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            this.totalBytesReceived += bytes.length;
            this.chunkCount++;
            
            // Add to pending chunks
            this.pendingChunks.push(bytes);
            
            // Process if ready
            if (this.isSourceOpen && !this.sourceBuffer.updating) {
                this.processPendingChunks();
            }
            
            // Start playback after receiving first chunk (with small buffer)
            if (!this.hasStartedPlayback && this.audioElement.buffered.length > 0) {
                const bufferedSeconds = this.audioElement.buffered.end(0);
                // Reduced from 0.5 to 0.1 seconds for faster start
                if (bufferedSeconds > 0.1) { // Wait for just 0.1 seconds of audio
                    this.startPlayback();
                }
            }
            
        } catch (error) {
            console.error('Failed to append chunk:', error);
            console.error('Chunk preview:', base64Chunk ? base64Chunk.substring(0, 50) + '...' : 'empty');
        }
    }

    /**
     * Process pending chunks
     */
    processPendingChunks() {
        if (!this.isSourceOpen || this.sourceBuffer.updating || this.pendingChunks.length === 0) {
            return;
        }
        
        try {
            // Concatenate all pending chunks
            const totalLength = this.pendingChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const concatenated = new Uint8Array(totalLength);
            let offset = 0;
            
            for (const chunk of this.pendingChunks) {
                concatenated.set(chunk, offset);
                offset += chunk.length;
            }
            
            // Clear pending chunks
            this.pendingChunks = [];
            
            // Append to source buffer
            this.sourceBuffer.appendBuffer(concatenated);
            
        } catch (error) {
            console.error('Failed to process pending chunks:', error);
            
            // If quota exceeded, try to remove some buffered data
            if (error.name === 'QuotaExceededError') {
                this.handleQuotaExceeded();
            }
        }
    }

    /**
     * Called when source buffer update ends
     */
    onUpdateEnd() {
        // Process more pending chunks if any
        this.processPendingChunks();
        
        // Try to start playback if we haven't yet
        if (!this.hasStartedPlayback && this.audioElement.buffered.length > 0) {
            const bufferedSeconds = this.audioElement.buffered.end(0);
            // Reduced from 0.5 to 0.1 seconds for faster start
            if (bufferedSeconds > 0.1) {
                this.startPlayback();
            }
        }
    }

    /**
     * Start audio playback
     */
    startPlayback() {
        if (this.hasStartedPlayback) return;
        
        console.log(`Starting playback with ${this.totalBytesReceived} bytes buffered`);
        this.hasStartedPlayback = true;
        
        this.audioElement.play().catch(error => {
            console.error('Failed to start playback:', error);
            // Try to recover by resetting and retrying
            if (error.name === 'NotAllowedError') {
                console.log('Playback blocked by browser - user interaction may be required');
            }
        });
    }

    /**
     * Signal end of stream
     */
    endStream() {
        console.log(`Stream ended: ${this.chunkCount} chunks, ${this.totalBytesReceived} bytes total`);
        
        if (!this.isSourceOpen) return;
        
        // Mark that we're ending the stream
        this.isStreamEnding = true;
        
        try {
            // Process any remaining chunks
            if (this.pendingChunks.length > 0) {
                this.processPendingChunks();
            }
            
            // Try to finalize after a short delay to ensure all updates complete
            this.tryFinalizeStream();
            
        } catch (error) {
            console.error('Failed to end stream:', error);
            this.cleanup();
        }
    }

    /**
     * Try to finalize the stream safely
     */
    tryFinalizeStream() {
        if (!this.sourceBuffer || !this.mediaSource) return;
        
        if (this.sourceBuffer.updating) {
            // Wait for current update to finish
            this.sourceBuffer.addEventListener('updateend', () => {
                this.tryFinalizeStream();
            }, { once: true });
        } else if (this.pendingChunks.length > 0) {
            // Still have chunks to process
            this.processPendingChunks();
            // Try again after processing
            setTimeout(() => this.tryFinalizeStream(), 10);
        } else {
            // Safe to finalize
            this.finalizeStream();
        }
    }

    /**
     * Finalize the stream
     */
    finalizeStream() {
        try {
            if (this.mediaSource && this.mediaSource.readyState === 'open') {
                this.mediaSource.endOfStream();
            }
            
            // Ensure playback starts if it hasn't
            if (!this.hasStartedPlayback && this.audioElement.buffered.length > 0) {
                this.startPlayback();
            }
        } catch (error) {
            console.error('Failed to finalize stream:', error);
            // Don't cleanup here, let playback complete
        }
    }

    /**
     * Handle quota exceeded error
     */
    handleQuotaExceeded() {
        console.warn('Source buffer quota exceeded, removing old data');
        
        try {
            const currentTime = this.audioElement.currentTime;
            const buffered = this.audioElement.buffered;
            
            if (buffered.length > 0 && currentTime > 30) {
                // Remove data from start to 30 seconds before current time
                const removeEnd = Math.max(0, currentTime - 30);
                this.sourceBuffer.remove(0, removeEnd);
            }
        } catch (error) {
            console.error('Failed to handle quota exceeded:', error);
        }
    }

    /**
     * Event handlers
     */
    onSourceEnded() {
        console.log('MediaSource ended');
    }

    onError(event) {
        console.error('MediaSource error:', event);
        this.cleanup();
    }

    onSourceBufferError(event) {
        console.error('SourceBuffer error:', event);
    }

    onPlaybackEnded() {
        console.log('Audio playback completed');
        this.cleanup();
        
        if (this.onCompleteCallback) {
            this.onCompleteCallback();
        }
    }

    onPlaybackError(event) {
        console.error('Audio playback error:', event);
        this.cleanup();
        
        // Still call completion callback on error
        if (this.onCompleteCallback) {
            this.onCompleteCallback();
        }
    }

    /**
     * Clean up resources
     */
    cleanup() {
        try {
            // Revoke object URL
            if (this.audioElement && this.audioElement.src) {
                URL.revokeObjectURL(this.audioElement.src);
            }
            
            // Reset state
            this.mediaSource = null;
            this.sourceBuffer = null;
            this.audioElement = null;
            this.pendingChunks = [];
            this.isInitialized = false;
            this.isSourceOpen = false;
            this.hasStartedPlayback = false;
            this.totalBytesReceived = 0;
            this.chunkCount = 0;
            
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    /**
     * Check if browser supports streaming
     */
    static isSupported() {
        return window.MediaSource && 
               MediaSource.isTypeSupported('audio/mpeg');
    }
}

// Export for use in main.js
window.StreamingAudioPlayer = StreamingAudioPlayer;