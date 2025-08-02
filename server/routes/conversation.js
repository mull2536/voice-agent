const express = require('express');
const router = express.Router();
const dataStore = require('../utils/simpleDataStore');
const logger = require('../utils/logger');

// Get recent conversations
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const conversations = await dataStore.getConversations(limit);
    
    res.json({
      success: true,
      conversations
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
    
    const context = await dataStore.getRecentContext(hoursBack, personId);
    
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
    
    const results = await dataStore.searchConversations(query);
    
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
    
    const allConversations = await dataStore.getConversations(limit * 2);
    const personConversations = allConversations.filter(c => c.personId === personId);
    
    res.json({
      success: true,
      conversations: personConversations.slice(0, limit)
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
    const conversations = await dataStore.getConversations(1000);
    const people = await dataStore.getPeople();
    
    // Calculate statistics
    const stats = {
      totalConversations: conversations.length,
      conversationsToday: conversations.filter(c => {
        const today = new Date().toDateString();
        return new Date(c.timestamp).toDateString() === today;
      }).length,
      conversationsByPerson: {},
      averageResponsesSelected: 0,
      mostActiveTimes: {}
    };
    
    // Count by person
    people.forEach(person => {
      stats.conversationsByPerson[person.name] = conversations.filter(
        c => c.personId === person.id
      ).length;
    });
    
    // Calculate average position of selected response
    let totalSelected = 0;
    let countSelected = 0;
    conversations.forEach(conv => {
      if (conv.selectedResponse && conv.responses) {
        const index = conv.responses.indexOf(conv.selectedResponse);
        if (index !== -1) {
          totalSelected += index;
          countSelected++;
        }
      }
    });
    
    if (countSelected > 0) {
      stats.averageResponsesSelected = (totalSelected / countSelected).toFixed(2);
    }
    
    // Most active hours
    conversations.forEach(conv => {
      const hour = new Date(conv.timestamp).getHours();
      stats.mostActiveTimes[hour] = (stats.mostActiveTimes[hour] || 0) + 1;
    });
    
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