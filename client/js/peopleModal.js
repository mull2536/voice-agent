// client/js/peopleModal.js

let currentPeople = [];
let selectedPersonId = null;
let selectedPersonForAction = null;
let currentMode = 'add'; // 'add', 'edit', or 'select'

// Helper function to show notifications
function showNotification(message, type) {
    // Use the app's notification system if available
    if (window.app && window.app.conversationUI && window.app.conversationUI.showNotification) {
        window.app.conversationUI.showNotification(message, type);
    } else {
        // Fallback to console
        console.log(`[${type}] ${message}`);
    }
}

// Initialize people modal
async function initializePeopleModal() {
    // Click outside to close
    document.getElementById('peopleModal').addEventListener('click', function(event) {
        if (event.target === this) {
            closePeopleModal();
        }
    });

    // Initialize with stored person if available
    const storedPersonId = localStorage.getItem('selectedPersonId');
    if (storedPersonId) {
        selectedPersonId = storedPersonId;
        // Load people first to ensure currentPeople is populated
        await loadPeople();
        updatePersonIndicator();
    } else {
        // Set default text if no one selected
        const indicator = document.getElementById('current-speaker');
        if (indicator) {
            indicator.textContent = 'No one selected';
        }
    }
}

// Open people modal
async function openPeopleModal() {
    const modal = document.getElementById('peopleModal');
    modal.style.display = 'block';
    
    // Reset to add mode
    setMode('add');
    selectedPersonForAction = null;
    
    // Clear forms
    clearForms();
    
    // Load and display people
    await loadPeople();
    
    // Add eye gaze targets if available
    if (window.eyeGazeControls && window.eyeGazeControls.isEnabled) {
        setTimeout(() => {
            const buttons = modal.querySelectorAll('.person-btn, .action-btn, .close-modal');
            buttons.forEach(btn => {
                window.eyeGazeControls.addTarget(btn);
            });
        }, 100);
    }
}

// Close people modal
function closePeopleModal() {
    const modal = document.getElementById('peopleModal');
    modal.style.display = 'none';
    
    // Remove eye gaze targets
    if (window.eyeGazeControls && window.eyeGazeControls.isEnabled) {
        const buttons = modal.querySelectorAll('.person-btn, .action-btn');
        buttons.forEach(btn => {
            window.eyeGazeControls.removeTarget(btn);
        });
    }
}

// Load people from server
async function loadPeople() {
    try {
        const response = await fetch('/api/people');
        const data = await response.json();
        
        if (data.success) {
            currentPeople = data.people;
            displayPeople();
        }
    } catch (error) {
        console.error('Failed to load people:', error);
        showNotification('Failed to load people', 'error');
    }
}

// Display people in grid
function displayPeople() {
    const grid = document.getElementById('peopleGrid');
    grid.innerHTML = '';
    
    currentPeople.forEach(person => {
        const button = document.createElement('button');
        button.className = 'person-btn';
        button.textContent = person.name;
        button.dataset.personId = person.id;
        
        // Don't show active class here - only show selected
        if (selectedPersonForAction && person.id === selectedPersonForAction.id) {
            button.classList.add('selected');
        }
        
        button.onclick = () => selectPersonForAction(person);
        grid.appendChild(button);
    });
}

// Select person for action
function selectPersonForAction(person) {
    selectedPersonForAction = person;
    
    // Update UI
    document.querySelectorAll('.person-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.personId === person.id) {
            btn.classList.add('selected');
        }
    });
    
    // Switch to edit mode and show appropriate buttons
    setMode('edit');
    
    // Fill edit form with person's data
    document.getElementById('editPersonName').value = person.name;
    document.getElementById('editPersonNotes').value = person.notes || '';
}

// Set modal mode
function setMode(mode) {
    currentMode = mode;
    
    const addSection = document.getElementById('addPersonSection');
    const editSection = document.getElementById('editPersonSection');
    const saveBtn = document.getElementById('saveBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const useBtn = document.getElementById('useBtn');
    
    if (mode === 'add') {
        addSection.style.display = 'block';
        editSection.style.display = 'none';
        saveBtn.style.display = 'block';
        saveBtn.textContent = 'Save';
        deleteBtn.style.display = 'none';
        useBtn.style.display = 'none';
    } else if (mode === 'edit') {
        addSection.style.display = 'none';
        editSection.style.display = 'block';
        saveBtn.style.display = 'block';
        saveBtn.textContent = 'Save';
        deleteBtn.style.display = 'block';  // Always show delete button
        useBtn.style.display = 'block';
    }
}

// Cancel action - simplified since we removed the Cancel button
function cancelAction() {
    // Reset to add mode
    setMode('add');
    selectedPersonForAction = null;
    clearForms();
    displayPeople(); // Refresh display to remove selection
}

// Clear forms
function clearForms() {
    document.getElementById('newPersonName').value = '';
    document.getElementById('newPersonNotes').value = '';
    document.getElementById('editPersonName').value = '';
    document.getElementById('editPersonNotes').value = '';
}

// Save or update person
async function saveOrUpdatePerson() {
    if (currentMode === 'add') {
        await saveNewPerson();
    } else if (currentMode === 'edit') {
        await updatePerson();
    }
}

// Save new person
async function saveNewPerson() {
    const name = document.getElementById('newPersonName').value.trim();
    const notes = document.getElementById('newPersonNotes').value.trim();
    
    if (!name) {
        showNotification('Please enter a name', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/people', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, notes })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Added ${name}`, 'success');
            clearForms();
            await loadPeople();
            
            // Auto-select the new person for use
            selectPersonForAction(data.person);
        } else {
            showNotification(data.error || 'Failed to add person', 'error');
        }
    } catch (error) {
        console.error('Failed to add person:', error);
        showNotification('Failed to add person', 'error');
    }
}

// Update existing person
async function updatePerson() {
    if (!selectedPersonForAction) return;
    
    const name = document.getElementById('editPersonName').value.trim();
    const notes = document.getElementById('editPersonNotes').value.trim();
    
    if (!name) {
        showNotification('Please enter a name', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/people/${selectedPersonForAction.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, notes })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Updated ${name}`, 'success');
            
            // Update the selected person object
            selectedPersonForAction.name = name;
            selectedPersonForAction.notes = notes;
            
            // Reload people
            await loadPeople();
            
            // Update indicator if this person is active
            if (selectedPersonForAction.id === selectedPersonId) {
                updatePersonIndicator();
            }
        } else {
            showNotification(data.error || 'Failed to update person', 'error');
        }
    } catch (error) {
        console.error('Failed to update person:', error);
        showNotification('Failed to update person', 'error');
    }
}

// Delete person
async function deletePerson() {
    if (!selectedPersonForAction) return;
    
    // Remove the default people check - allow deletion of any person
    if (!confirm(`Are you sure you want to delete ${selectedPersonForAction.name}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/people/${selectedPersonForAction.id}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Person deleted', 'success');
            
            // If deleted person was the active one, clear selection
            if (selectedPersonForAction.id === selectedPersonId) {
                selectedPersonId = null;
                localStorage.removeItem('selectedPersonId');
                updatePersonIndicator();
            }
            
            // Reset to add mode
            setMode('add');
            selectedPersonForAction = null;
            clearForms();
            await loadPeople();
        }
    } catch (error) {
        console.error('Failed to delete person:', error);
        showNotification('Failed to delete person', 'error');
    }
}

// Use the selected person
function usePerson() {
    if (!selectedPersonForAction) return;
    
    selectedPersonId = selectedPersonForAction.id;
    localStorage.setItem('selectedPersonId', selectedPersonForAction.id);
    
    // Update UI
    updatePersonIndicator();
    
    // Notify server
    if (window.socket) {
        window.socket.emit('set-person', selectedPersonForAction.id);
    }
    
    showNotification(`Now talking to: ${selectedPersonForAction.name}`, 'success');
    
    // Close modal after short delay
    setTimeout(() => {
        closePeopleModal();
    }, 300);
}

// Update person indicator in header
function updatePersonIndicator() {
    const indicator = document.getElementById('current-speaker');
    if (indicator) {
        if (selectedPersonId && currentPeople.length > 0) {
            const person = currentPeople.find(p => p.id === selectedPersonId);
            if (person) {
                indicator.textContent = `Talking to: ${person.name}`;
            } else {
                indicator.textContent = 'No one selected';
            }
        } else {
            indicator.textContent = 'No one selected';
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initializePeopleModal);