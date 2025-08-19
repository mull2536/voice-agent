// server/routes/urls.js
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Get RAG service instance
let ragService = null;
function getRagService() {
    if (!ragService) {
        const { getRAGServiceInstance } = require('../services/rag');
        ragService = getRAGServiceInstance();
    }
    return ragService;
}

// Get all indexed URLs
router.get('/', async (req, res) => {
    try {
        const ragService = getRagService();
        
        if (!ragService) {
            return res.status(500).json({
                success: false,
                error: 'RAG service not available'
            });
        }
        
        const urls = ragService.getIndexedURLs();
        
        res.json({
            success: true,
            urls: urls
        });
    } catch (error) {
        logger.error('Failed to get indexed URLs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get indexed URLs'
        });
    }
});

// Add URL to index
router.post('/add', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }
        
        // Basic URL validation
        try {
            new URL(url);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }
        
        const ragService = getRagService();
        
        if (!ragService) {
            return res.status(500).json({
                success: false,
                error: 'RAG service not available'
            });
        }
        
        logger.info(`Indexing URL: ${url}`);
        
        const result = await ragService.indexURL(url);
        
        // Check if the result indicates existing URL
        if (!result.success && result.existing) {
            console.log('URL already exists:', url);
            return res.status(400).json({
                success: false,
                existing: true,
                error: 'This URL is already indexed. Use the Update button to refresh it.'
            });
        }

        // Check for other failures
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error || 'Failed to index URL'
            });
        }
        
        res.json({
            success: true,
            url: result.url,
            title: result.title,
            chunks: result.chunks,
            key: result.key
        });
    } catch (error) {
        logger.error('Failed to index URL:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to index URL'
        });
    }
});

// Refresh URL (re-fetch and update)
router.post('/:key/refresh', async (req, res) => {
    try {
        const { key } = req.params;
        
        const ragService = getRagService();
        
        if (!ragService) {
            return res.status(500).json({
                success: false,
                error: 'RAG service not available'
            });
        }
        
        // Get URL info from the key
        const urlInfo = ragService.getIndexedURLs().find(u => u.key === key);
        
        if (!urlInfo) {
            return res.status(404).json({
                success: false,
                error: 'URL not found'
            });
        }
        
        logger.info(`Refreshing URL: ${urlInfo.url}`);
        
        // Remove old entry and re-index
        await ragService.removeURL(key);
        const result = await ragService.indexURL(urlInfo.url);
        
        res.json({
            success: true,
            url: result.url,
            title: result.title,
            chunks: result.chunks,
            key: result.key
        });
    } catch (error) {
        logger.error('Failed to refresh URL:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to refresh URL'
        });
    }
});

// Remove URL from index
router.delete('/:key', async (req, res) => {
    try {
        const { key } = req.params;
        
        const ragService = getRagService();
        
        if (!ragService) {
            return res.status(500).json({
                success: false,
                error: 'RAG service not available'
            });
        }
        
        logger.info(`Removing URL with key: ${key}`);
        
        const result = await ragService.removeURL(key);
        
        res.json({
            success: true,
            message: 'URL removed from index'
        });
    } catch (error) {
        logger.error('Failed to remove URL:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to remove URL'
        });
    }
});

module.exports = router;