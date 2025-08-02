const db = require('../config/database');
const logger = require('./logger');

class ContextManager {
  constructor() {
    this.recentConversationsLimit = 10;
    this.contextWindowSize = 5; // Number of recent messages to include
  }

  async getConversationContext() {
    try {
      // Get recent conversations
      const recentConversations = await db.getRecentConversations(this.recentConversationsLimit);
      
      // Process and weight conversations
      const context = [];
      const now = new Date();
      
      for (const conversation of recentConversations) {
        const age = (now - new Date(conversation.timestamp)) / (1000 * 60 * 60); // hours
        const weight = this.calculateWeight(age);
        
        context.push({
          speaker: conversation.speaker_name || 'Unknown',
          message: conversation.transcript,
          response: conversation.selected_response,
          timestamp: conversation.timestamp,
          weight
        });
      }
      
      // Sort by weight and timestamp
      context.sort((a, b) => {
        if (Math.abs(a.weight - b.weight) > 0.1) {
          return b.weight - a.weight;
        }
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      
      // Return top context items
      return context.slice(0, this.contextWindowSize);
      
    } catch (error) {
      logger.error('Failed to get conversation context:', error);
      return [];
    }
  }

  calculateWeight(ageInHours) {
    // Exponential decay function for recency weighting
    // Recent conversations have weight close to 1
    // Older conversations decay exponentially
    const decayRate = 0.1;
    return Math.exp(-decayRate * ageInHours);
  }

  async storeConversation(data) {
    try {
      const conversationId = await db.createConversation({
        speakerId: data.speaker?.id,
        transcript: data.transcript,
        responses: data.responses,
        context: {
          timestamp: data.timestamp,
          speakerInfo: data.speaker
        }
      });

      // Store initial chat message
      await db.addChatMessage(conversationId, 'user', data.transcript);

      logger.info(`Conversation stored with ID: ${conversationId}`);
      return conversationId;

    } catch (error) {
      logger.error('Failed to store conversation:', error);
      throw error;
    }
  }

  async updateConversationWithResponse(conversationId, selectedResponse) {
    try {
      await db.updateConversation(conversationId, selectedResponse);
      await db.addChatMessage(conversationId, 'assistant', selectedResponse);
      
      logger.info(`Conversation ${conversationId} updated with selected response`);
      
    } catch (error) {
      logger.error('Failed to update conversation:', error);
      throw error;
    }
  }

  async getFullConversationHistory(conversationId) {
    try {
      const history = await db.getChatHistory(conversationId);
      return history;
      
    } catch (error) {
      logger.error('Failed to get conversation history:', error);
      return [];
    }
  }

  async getSpeakerContext(speakerId) {
    try {
      const speaker = await db.getSpeaker(speakerId);
      
      if (!speaker) {
        return null;
      }

      // Get recent conversations with this speaker
      const conversations = await db.getRecentConversations(20);
      const speakerConversations = conversations.filter(c => c.speaker_id === speakerId);

      return {
        name: speaker.name,
        notes: speaker.notes,
        lastSeen: speaker.last_seen,
        recentTopics: this.extractTopics(speakerConversations),
        conversationCount: speakerConversations.length
      };

    } catch (error) {
      logger.error('Failed to get speaker context:', error);
      return null;
    }
  }

  extractTopics(conversations) {
    // Simple keyword extraction
    // In production, you might use NLP libraries for better topic extraction
    const keywords = new Map();
    
    for (const conv of conversations) {
      const words = conv.transcript.toLowerCase().split(/\s+/);
      
      for (const word of words) {
        // Filter out common words and short words
        if (word.length > 4 && !this.isCommonWord(word)) {
          keywords.set(word, (keywords.get(word) || 0) + 1);
        }
      }
    }

    // Return top keywords as topics
    return Array.from(keywords.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  isCommonWord(word) {
    const commonWords = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'been',
      'what', 'where', 'when', 'which', 'would', 'could', 'should', 'about'
    ]);
    
    return commonWords.has(word);
  }

  async archiveOldConversations() {
    try {
      const archivedCount = await db.archiveOldConversations(30); // 30 days
      logger.info(`Archived ${archivedCount} old conversations`);
      
    } catch (error) {
      logger.error('Failed to archive conversations:', error);
    }
  }
}

const contextManager = new ContextManager();

module.exports = {
  getConversationContext: () => contextManager.getConversationContext(),
  storeConversation: (data) => contextManager.storeConversation(data),
  updateConversationWithResponse: (id, response) => contextManager.updateConversationWithResponse(id, response),
  getFullConversationHistory: (id) => contextManager.getFullConversationHistory(id),
  getSpeakerContext: (speakerId) => contextManager.getSpeakerContext(speakerId),
  archiveOldConversations: () => contextManager.archiveOldConversations()
};