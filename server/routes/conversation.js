const express = require('express');
const router = express.Router();
const dataStore = require('../utils/simpleDataStore');
const logger = require('../utils/logger');
const { getChatHistoryService } = require('../services/llm'); // Import to get chatHistoryService

// Helper function to generate personId from person name
function generatePersonId(personName) {
  return personName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Get recent conversations
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    // Get chat history service instance
    const chatHistoryService = getChatHistoryService();
    if (!chatHistoryService) {
      throw new Error('Chat history service not initialized');
    }
    
    // Load chat history
    const chatHistory = await chatHistoryService.loadChatHistory();
    
    // Transform to match existing UI expectations
    const conversations = [];
    
    for (const conv of chatHistory.conversations) {
      // Get all exchanges sorted by timestamp
      const sortedExchanges = [...conv.exchanges]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Transform each exchange to match conversation format
      for (const exchange of sortedExchanges) {
        conversations.push({
          id: `${conv.id}_${exchange.timestamp}`,
          timestamp: exchange.timestamp,
          personId: generatePersonId(conv.person),
          personName: conv.person,
          userMessage: exchange.user,
          selectedResponse: exchange.assistant  // Can be null for unresponded
        });
      }
    }
    
    // Sort all conversations by timestamp and limit
    conversations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedConversations = conversations.slice(0, limit);
    
    res.json({
      success: true,
      conversations: limitedConversations
    });
  } catch (error) {
    logger.error('Failed to get recent conversations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve conversations'
    });
  }
});

// Get conversation context for LLM
router.get('/context', async (req, res) => {
  try {
    const personId = req.query.personId || null;
    const hoursBack = parseInt(req.query.hoursBack) || 24;
    
    // Get chat history service
    const chatHistoryService = getChatHistoryService();
    if (!chatHistoryService) {
      throw new Error('Chat history service not initialized');
    }
    
    // Load chat history
    const chatHistory = await chatHistoryService.loadChatHistory();
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    
    // Build context from recent exchanges
    const contextParts = [];
    
    for (const conv of chatHistory.conversations) {
      // Filter by person if specified
      if (personId && generatePersonId(conv.person) !== personId) {
        continue;
      }
      
      // Get recent exchanges within time window
      const recentExchanges = conv.exchanges.filter(
        exchange => new Date(exchange.timestamp) > cutoffTime
      );
      
      // Add to context
      for (const exchange of recentExchanges) {
        contextParts.push({
          timestamp: exchange.timestamp,
          person: conv.person,
          user: exchange.user,
          assistant: exchange.assistant
        });
      }
    }
    
    // Sort by timestamp
    contextParts.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Format as context string
    const context = contextParts.map(part => {
      let text = `[${new Date(part.timestamp).toLocaleString()}] ${part.person}: ${part.user}`;
      if (part.assistant) {
        text += `\nAssistant: ${part.assistant}`;
      }
      return text;
    }).join('\n\n');
    
    res.json({
      success: true,
      context
    });
  } catch (error) {
    logger.error('Failed to get conversation context:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve context'
    });
  }
});

// Search conversations
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }
    
    const chatHistoryService = getChatHistoryService();
    if (!chatHistoryService) {
      throw new Error('Chat history service not initialized');
    }
    
    const chatHistory = await chatHistoryService.loadChatHistory();
    const searchLower = query.toLowerCase();
    const results = [];
    
    // Search through all exchanges
    for (const conv of chatHistory.conversations) {
      for (const exchange of conv.exchanges) {
        if (exchange.user.toLowerCase().includes(searchLower) || 
            (exchange.assistant && exchange.assistant.toLowerCase().includes(searchLower))) {
          results.push({
            id: `${conv.id}_${exchange.timestamp}`,
            timestamp: exchange.timestamp,
            personId: generatePersonId(conv.person),
            personName: conv.person,
            userMessage: exchange.user,
            selectedResponse: exchange.assistant,
            // Add match context for highlighting
            matchedIn: exchange.user.toLowerCase().includes(searchLower) ? 'user' : 'assistant'
          });
        }
      }
    }
    
    // Sort by relevance (most recent first)
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({
      success: true,
      results,
      count: results.length
    });
  } catch (error) {
    logger.error('Failed to search conversations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search conversations'
    });
  }
});

// Export all data
router.get('/export', async (req, res) => {
  try {
    const exportData = await dataStore.exportData();
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="smf-communication-export-${new Date().toISOString().split('T')[0]}.json"`);
    res.send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    logger.error('Failed to export data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export data'
    });
  }
});

// Get conversations by person
router.get('/by-person/:personId', async (req, res) => {
  try {
    const { personId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    const chatHistoryService = getChatHistoryService();
    if (!chatHistoryService) {
      throw new Error('Chat history service not initialized');
    }
    
    const chatHistory = await chatHistoryService.loadChatHistory();
    const conversations = [];
    
    // Find conversations for this person
    for (const conv of chatHistory.conversations) {
      if (generatePersonId(conv.person) === personId) {
        // Add all exchanges from this person's conversations
        for (const exchange of conv.exchanges) {
          conversations.push({
            id: `${conv.id}_${exchange.timestamp}`,
            timestamp: exchange.timestamp,
            personId: personId,
            personName: conv.person,
            userMessage: exchange.user,
            selectedResponse: exchange.assistant
          });
        }
      }
    }
    
    // Sort by timestamp and limit
    conversations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedConversations = conversations.slice(0, limit);
    
    res.json({
      success: true,
      conversations: limitedConversations
    });
  } catch (error) {
    logger.error('Failed to get conversations by person:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve conversations'
    });
  }
});

// Get conversation statistics
router.get('/stats', async (req, res) => {
  try {
    const chatHistoryService = getChatHistoryService();
    if (!chatHistoryService) {
      throw new Error('Chat history service not initialized');
    }
    
    const chatHistory = await chatHistoryService.loadChatHistory();
    const people = await dataStore.getPeople();
    
    // Calculate statistics
    const stats = {
      totalConversations: 0,
      conversationsToday: 0,
      conversationsByPerson: {},
      unrespondedCount: 0,
      averageResponseTime: 0,
      mostActiveTimes: {}
    };
    
    const today = new Date().toDateString();
    
    // Initialize person stats
    people.forEach(person => {
      stats.conversationsByPerson[person.name] = 0;
    });
    
    // Process all exchanges
    for (const conv of chatHistory.conversations) {
      for (const exchange of conv.exchanges) {
        stats.totalConversations++;
        
        // Count today's conversations
        if (new Date(exchange.timestamp).toDateString() === today) {
          stats.conversationsToday++;
        }
        
        // Count by person
        if (stats.conversationsByPerson[conv.person] !== undefined) {
          stats.conversationsByPerson[conv.person]++;
        } else {
          stats.conversationsByPerson[conv.person] = 1;
        }
        
        // Count unresponded
        if (!exchange.assistant) {
          stats.unrespondedCount++;
        }
        
        // Track active hours
        const hour = new Date(exchange.timestamp).getHours();
        stats.mostActiveTimes[hour] = (stats.mostActiveTimes[hour] || 0) + 1;
      }
    }
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Failed to get statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate statistics'
    });
  }
});

module.exports = router;