const express = require('express');
const router = express.Router();
const dataStore = require('../utils/simpleDataStore');

// Get all people
router.get('/', async (req, res) => {
    try {
        const people = await dataStore.getPeople();
        res.json({ success: true, people });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add a person
router.post('/', async (req, res) => {
    try {
        const { name, notes } = req.body;
        
        if (!name) {
            return res.status(400).json({ 
                success: false, 
                error: 'Name is required' 
            });
        }
        
        const person = await dataStore.addPerson({ name, notes });
        res.json({ success: true, person });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update a person
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const person = await dataStore.updatePerson(id, updates);
        res.json({ success: true, person });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete a person
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await dataStore.deletePerson(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get person context
router.get('/:id/context', async (req, res) => {
    try {
        const { id } = req.params;
        const context = await dataStore.getPersonContext(id);
        res.json({ success: true, context });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;