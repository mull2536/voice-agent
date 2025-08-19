// server/routes/memories.js
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

// Get RAG service instance
let ragService = null;
function getRagService() {
    if (!ragService) {
        const { getRAGServiceInstance } = require('../services/rag');
        ragService = getRAGServiceInstance();
    }
    return ragService;
}

// Path to memories file
const memoriesPath = path.join(config.paths.knowledgeBase, 'memories.json');

// Ensure KB directory exists
async function ensureKBDirectory() {
    await fs.mkdir(config.paths.knowledgeBase, { recursive: true });
}

// Load memories from file
async function loadMemories() {
    try {
        await ensureKBDirectory();
        const data = await fs.readFile(memoriesPath, 'utf-8');
        const json = JSON.parse(data);
        return json.memories || [];
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, create it
            await saveMemories([]);
            return [];
        }
        throw error;
    }
}

// Save memories to file
async function saveMemories(memories) {
    await ensureKBDirectory();
    const data = { memories };
    await fs.writeFile(memoriesPath, JSON.stringify(data, null, 2));
}

// Get memories with pagination
router.get('/', async (req, res) => {
    try {
        const offset = parseInt(req.query.offset) || 0;
        const limit = parseInt(req.query.limit) || 8;

        // Get all memories (sorted by date, newest first)
        const allMemories = await loadMemories();
        allMemories.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Slice for pagination
        const memories = allMemories.slice(offset, offset + limit);

        // Check if there are more memories beyond this page
        const hasMore = (offset + limit) < allMemories.length;

        res.json({
            success: true,
            memories: memories,
            hasMore: hasMore,
            total: allMemories.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load memories'
        });
    }
});

// Add new memory
router.post('/', async (req, res) => {
    try {
        const { title, date, tags, text } = req.body;
        
        logger.info('Add memory request:', { title, date, tags: tags?.length, textLength: text?.length });
        
        if (!title || !date || !text) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        const memories = await loadMemories();
        
        const newMemory = {
            title,
            tags: tags || [],
            date,
            text,
            timestamp: new Date().toISOString()
        };
        
        memories.push(newMemory);
        await saveMemories(memories);
        
        logger.info('Memory saved successfully');
        
        // Re-index memories file in background
        const ragService = getRagService();
        if (ragService && ragService.indexFile) {
            logger.info('Starting memory indexing...');
            
            ragService.indexFile(memoriesPath)
                .then(() => {
                    logger.info('Memory indexing completed');
                })
                .catch(error => {
                    logger.error('Failed to index memories:', error);
                });
        }
        
        res.json({
            success: true,
            memory: newMemory
        });
    } catch (error) {
        logger.error('Failed to add memory:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to add memory'
        });
    }
});

// Update memory
router.put('/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const { title, date, tags, text } = req.body;
        
        if (!title || !date || !text) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        const memories = await loadMemories();
        
        // Sort memories the same way as GET to ensure correct index
        memories.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        if (index < 0 || index >= memories.length) {
            return res.status(404).json({
                success: false,
                error: 'Memory not found'
            });
        }
        
        memories[index] = {
            ...memories[index],
            title,
            tags: tags || [],
            date,
            text,
            timestamp: new Date().toISOString()
        };
        
        await saveMemories(memories);
        
        // Re-index memories file
        const ragService = getRagService();
        if (ragService && ragService.indexFile) {
            ragService.indexFile(memoriesPath).catch(error => {
                logger.error('Failed to index memories:', error);
            });
        }
        
        res.json({
            success: true,
            memory: memories[index]
        });
    } catch (error) {
        logger.error('Failed to update memory:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update memory'
        });
    }
});

// Delete memories
router.post('/delete', async (req, res) => {
    try {
        const { indices } = req.body;
        
        logger.info('Delete memories request for indices:', indices);
        
        if (!indices || !Array.isArray(indices)) {
            return res.status(400).json({
                success: false,
                error: 'No indices provided'
            });
        }
        
        const memories = await loadMemories();
        
        // Sort memories the same way as GET to ensure correct indices
        memories.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        // Sort indices in descending order to avoid index shifting
        const sortedIndices = indices.sort((a, b) => b - a);
        
        let deletedCount = 0;
        for (const index of sortedIndices) {
            if (index >= 0 && index < memories.length) {
                memories.splice(index, 1);
                deletedCount++;
                logger.info(`Deleted memory at index ${index}`);
            }
        }
        
        await saveMemories(memories);
        logger.info(`Successfully deleted ${deletedCount} memories`);
        
        // Re-index memories file
        const ragService = getRagService();
        if (ragService && ragService.indexFile) {
            ragService.indexFile(memoriesPath).catch(error => {
                logger.error('Failed to index memories:', error);
            });
        }
        
        res.json({
            success: true,
            deletedCount,
            message: `Deleted ${deletedCount} memories`
        });
    } catch (error) {
        logger.error('Failed to delete memories:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete memories'
        });
    }
});

module.exports = router;