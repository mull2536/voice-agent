// Conversation UI management
class ConversationUI {
    constructor() {
        this.transcriptContainer = document.getElementById('transcript-container');
        this.messageHistory = [];
        this.isConnected = false;
    }
    
    addMessage(messageData) {
        const { speaker, content, type, timestamp } = messageData;
        
        // Remove welcome message if it exists
        const welcomeMessage = this.transcriptContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }
        
        // Create message element
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        
        // Add speaker info
        const speakerEl = document.createElement('div');
        speakerEl.className = 'message-speaker';
        speakerEl.textContent = speaker;
        messageEl.appendChild(speakerEl);
        
        // Add message content
        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        contentEl.textContent = content;
        messageEl.appendChild(contentEl);
        
        // Add to container
        this.transcriptContainer.appendChild(messageEl);
        
        // Store in history
        this.messageHistory.push({
            speaker,
            content,
            type,
            timestamp: timestamp || new Date()
        });
        
        // Scroll to bottom
        this.scrollToBottom();
    }
    
    scrollToBottom() {
        // Use setTimeout to ensure DOM has updated
        setTimeout(() => {
            // Get the conversation display container (the scrollable element)
            const conversationDisplay = document.querySelector('.conversation-display');
            if (conversationDisplay) {
                conversationDisplay.scrollTop = conversationDisplay.scrollHeight;
            }
        }, 50);
    }
    
    showSpeechIndicator() {
        // You could add a visual indicator that speech is being detected
        const indicator = document.createElement('div');
        indicator.id = 'speech-indicator';
        indicator.className = 'speech-indicator';
        indicator.innerHTML = '<span class="pulse"></span> Listening...';
        
        const lastMessage = this.transcriptContainer.lastElementChild;
        if (lastMessage) {
            this.transcriptContainer.insertBefore(indicator, lastMessage.nextSibling);
        } else {
            this.transcriptContainer.appendChild(indicator);
        }
    }
    
    hideSpeechIndicator() {
        const indicator = document.getElementById('speech-indicator');
        if (indicator) {
            indicator.remove();
        }
    }
    
    setConnectionStatus(connected) {
        this.isConnected = connected;
        
        // Update UI to show connection status
        const header = document.querySelector('.app-header');
        if (connected) {
            header.classList.remove('disconnected');
        } else {
            header.classList.add('disconnected');
            this.showNotification('Connection lost. Trying to reconnect...', 'warning');
        }
    }
    
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add to body
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Remove after delay
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }
    
    clearConversation() {
        this.transcriptContainer.innerHTML = `
            <div class="welcome-message">
                <h2>Welcome!</h2>
                <p>Start a conversation by speaking or typing below.</p>
            </div>
        `;
        this.messageHistory = [];
    }
    
    exportConversation() {
        // Create text version of conversation
        let text = 'Conversation Export\n';
        text += '==================\n\n';
        
        this.messageHistory.forEach(msg => {
            text += `${msg.speaker} (${new Date(msg.timestamp).toLocaleString()}):\n`;
            text += `${msg.content}\n\n`;
        });
        
        // Create download link
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation_${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    searchConversation(query) {
        if (!query) {
            // Show all messages
            const messages = this.transcriptContainer.querySelectorAll('.message');
            messages.forEach(msg => {
                msg.style.display = 'block';
            });
            return;
        }
        
        const searchTerm = query.toLowerCase();
        const messages = this.transcriptContainer.querySelectorAll('.message');
        
        messages.forEach(msg => {
            const content = msg.querySelector('.message-content').textContent.toLowerCase();
            const speaker = msg.querySelector('.message-speaker').textContent.toLowerCase();
            
            if (content.includes(searchTerm) || speaker.includes(searchTerm)) {
                msg.style.display = 'block';
                // Highlight matching text
                this.highlightText(msg, searchTerm);
            } else {
                msg.style.display = 'none';
            }
        });
    }
    
    highlightText(element, searchTerm) {
        const contentEl = element.querySelector('.message-content');
        const text = contentEl.textContent;
        const regex = new RegExp(`(${searchTerm})`, 'gi');
        const highlighted = text.replace(regex, '<mark>$1</mark>');
        contentEl.innerHTML = highlighted;
    }
    
    showTypingIndicator(speaker = 'Assistant') {
        const typingEl = document.createElement('div');
        typingEl.className = 'message assistant typing';
        typingEl.id = 'typing-indicator';
        
        typingEl.innerHTML = `
            <div class="message-speaker">${speaker}</div>
            <div class="message-content">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        `;
        
        this.transcriptContainer.appendChild(typingEl);
        this.scrollToBottom();
    }
    
    hideTypingIndicator() {
        const typingEl = document.getElementById('typing-indicator');
        if (typingEl) {
            typingEl.remove();
        }
    }
    
    updateMessageStatus(messageId, status) {
        // Find message and update its status
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl) {
            messageEl.dataset.status = status;
            
            // Add visual indicator
            const statusEl = messageEl.querySelector('.message-status');
            if (statusEl) {
                statusEl.className = `message-status ${status}`;
            }
        }
    }
}