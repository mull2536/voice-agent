// server/routes/files.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
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

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadPath = config.paths.knowledgeBase;
        try {
            await fs.mkdir(uploadPath, { recursive: true });
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        // Sanitize filename
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, sanitized);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        '.txt', 
        '.md', 
        '.json', 
        '.pdf', 
        '.docx',
        '.csv',   // ADD THIS
        '.xlsx'   // ADD THIS
    ];
    
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${ext} not supported`));
    }
};

const upload = multer({
    storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Get all files with indexing status
router.get('/', async (req, res) => {
    try {
        const kbPath = config.paths.knowledgeBase;
        await fs.mkdir(kbPath, { recursive: true });
        
        const files = await fs.readdir(kbPath);
        const ragService = getRagService();
        
        const fileData = await Promise.all(files.map(async (filename) => {
            const filePath = path.join(kbPath, filename);
            const stats = await fs.stat(filePath);
            
            if (stats.isDirectory()) return null;
            
            // Check if file is indexed
            let indexed = false;
            if (ragService && ragService.fileIndex) {
                const fileInfo = ragService.fileIndex.get(filename);
                indexed = fileInfo ? true : false;
            }
            
            return {
                name: filename,
                size: stats.size,
                modified: stats.mtime,
                indexed,
                indexing: false // Will be updated via socket if actively indexing
            };
        }));
        
        res.json({
            success: true,
            files: fileData.filter(f => f !== null)
        });
    } catch (error) {
        logger.error('Failed to list files:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list files'
        });
    }
});

// Upload files
router.post('/upload', upload.array('files', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded'
            });
        }
        
        const ragService = getRagService();
        const uploadedFiles = [];
        
        // Start indexing each file
        for (const file of req.files) {
            uploadedFiles.push(file.filename);
            
            // Index file asynchronously
            const filePath = path.join(config.paths.knowledgeBase, file.filename);
            
            // Emit indexing started event
            if (req.app.locals.io) {
                req.app.locals.io.emit('file-indexing-progress', {
                    filename: file.filename,
                    status: 'indexing'
                });
            }
            
            // Index the file
            if (ragService && ragService.indexFile) {
                ragService.indexFile(filePath).then(() => {
                    // Emit indexing completed event
                    if (req.app.locals.io) {
                        req.app.locals.io.emit('file-indexing-progress', {
                            filename: file.filename,
                            status: 'completed'
                        });
                    }
                }).catch(error => {
                    logger.error(`Failed to index ${file.filename}:`, error);
                    if (req.app.locals.io) {
                        req.app.locals.io.emit('file-indexing-progress', {
                            filename: file.filename,
                            status: 'failed'
                        });
                    }
                });
            }
        }
        
        res.json({
            success: true,
            uploadedFiles,
            message: `Uploaded ${uploadedFiles.length} files`
        });
    } catch (error) {
        logger.error('Failed to upload files:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to upload files'
        });
    }
});

// Delete files
router.post('/delete', async (req, res) => {
    try {
        const { filenames } = req.body;
        
        if (!filenames || !Array.isArray(filenames)) {
            return res.status(400).json({
                success: false,
                error: 'No filenames provided'
            });
        }
        
        logger.info('Delete request for files:', filenames);
        
        const ragService = getRagService();
        let deletedCount = 0;
        const errors = [];
        
        for (const filename of filenames) {
            const filePath = path.join(config.paths.knowledgeBase, filename);
            
            try {
                // Check if file exists
                await fs.access(filePath);
                
                // Delete physical file
                await fs.unlink(filePath);
                logger.info(`Deleted physical file: ${filename}`);
                
                // Remove from vector store index if RAG service is available
                if (ragService && ragService.removeFile) {
                    await ragService.removeFile(filename);
                    logger.info(`Removed from index: ${filename}`);
                }
                
                deletedCount++;
            } catch (error) {
                logger.error(`Failed to delete ${filename}:`, error);
                errors.push({ filename, error: error.message });
            }
        }
        
        const response = {
            success: true,
            deletedCount,
            totalRequested: filenames.length,
            message: `Deleted ${deletedCount} of ${filenames.length} files`
        };
        
        if (errors.length > 0) {
            response.errors = errors;
        }
        
        res.json(response);
    } catch (error) {
        logger.error('Failed to delete files:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete files'
        });
    }
});

module.exports = router;