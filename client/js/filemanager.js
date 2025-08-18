// client/js/fileManager.js

let currentFiles = [];
let selectedFiles = new Set();
let currentMemories = [];
let selectedMemories = new Set();
let memoriesOffset = 0;
let filesOffset = 0;
const MEMORIES_PER_PAGE = 8;
const FILES_PER_PAGE = 8;
let currentTab = 'files';
let editingMemory = null;
let allFilesLoaded = false;
let currentURLs = [];
let urlsLoading = false;

// Helper function to show notifications
function showNotification(message, type) {
    if (window.app && window.app.conversationUI && window.app.conversationUI.showNotification) {
        window.app.conversationUI.showNotification(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
}

// Initialize file manager
async function initializeFileManager() {
    // Click outside to close
    document.getElementById('fileManagerModal').addEventListener('click', function(event) {
        if (event.target === this) {
            closeFileManager();
        }
    });

    // Tab switching
    document.querySelectorAll('#fileManagerModal .tab-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            await switchTab(e.target.dataset.tab);
        });
    });

    // File actions
    const deleteFilesBtn = document.getElementById('deleteFilesBtn');
    const addFilesBtn = document.getElementById('addFilesBtn');
    const fileUploadInput = document.getElementById('fileUploadInput');
    const loadMoreFilesBtn = document.getElementById('loadMoreFilesBtn');
    
    if (deleteFilesBtn) deleteFilesBtn.addEventListener('click', deleteSelectedFiles);
    if (addFilesBtn) addFilesBtn.addEventListener('click', () => {
        if (fileUploadInput) fileUploadInput.click();
    });
    if (fileUploadInput) fileUploadInput.addEventListener('change', handleFileUpload);
    if (loadMoreFilesBtn) loadMoreFilesBtn.addEventListener('click', loadMoreFiles);

// Memory actions
    const deleteMemoriesBtn = document.getElementById('deleteMemoriesBtn');
    const editMemoryBtn = document.getElementById('editMemoryBtn');
    const addMemoryBtn = document.getElementById('addMemoryBtn');
    const loadMoreMemoriesBtn = document.getElementById('loadMoreMemoriesBtn');
    
    if (deleteMemoriesBtn) deleteMemoriesBtn.addEventListener('click', deleteSelectedMemories);
    if (editMemoryBtn) editMemoryBtn.addEventListener('click', editSelectedMemory);
    if (addMemoryBtn) addMemoryBtn.addEventListener('click', () => showMemoryForm());
    if (loadMoreMemoriesBtn) loadMoreMemoriesBtn.addEventListener('click', loadMoreMemories);

    // Memory form
    const saveMemoryBtn = document.getElementById('saveMemoryBtn');
    const cancelMemoryBtn = document.getElementById('cancelMemoryBtn');
    
    if (saveMemoryBtn) saveMemoryBtn.addEventListener('click', saveMemory);
    if (cancelMemoryBtn) cancelMemoryBtn.addEventListener('click', hideMemoryForm);

    // File selection
    document.getElementById('filesList').addEventListener('click', handleFileSelection);
    document.getElementById('memoriesList').addEventListener('click', handleMemorySelection);

    // URL functionality
    document.getElementById('add-url-btn')?.addEventListener('click', addURL);
    document.getElementById('url-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addURL();
        }
    });
}

// Open file manager
async function openFileManager() {
    const modal = document.getElementById('fileManagerModal');
    modal.style.display = 'block';
    
    // Reset selections and offsets
    selectedFiles.clear();
    selectedMemories.clear();
    memoriesOffset = 0;
    filesOffset = 0;
    
    // Load initial data
    if (currentTab === 'files') {
        await loadFiles();
    } else {
        await loadMemories();
    }
    
    // Add eye gaze targets if available
    if (window.eyeGazeControls && window.eyeGazeControls.isEnabled) {
        setTimeout(() => {
            const buttons = modal.querySelectorAll('.action-btn, .tab-btn, .close-modal');
            buttons.forEach(btn => {
                window.eyeGazeControls.addTarget(btn);
            });
        }, 100);
    }
}

// Close file manager
function closeFileManager() {
    const modal = document.getElementById('fileManagerModal');
    modal.style.display = 'none';
    
    // Remove eye gaze targets
    if (window.eyeGazeControls && window.eyeGazeControls.isEnabled) {
        const buttons = modal.querySelectorAll('.action-btn, .tab-btn');
        buttons.forEach(btn => {
            window.eyeGazeControls.removeTarget(btn);
        });
    }
}

// Switch tabs
async function switchTab(tab) {
    currentTab = tab;
    
    // Update tab buttons
    document.querySelectorAll('#fileManagerModal .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    
    // Update tab content
    document.querySelectorAll('#fileManagerModal .tab-content').forEach(content => {
        const shouldBeActive = content.id === `${tab}-tab`;
        content.classList.toggle('active', shouldBeActive);
        content.style.display = shouldBeActive ? 'block' : 'none';
    });
    
    // Reset offsets when switching tabs
    filesOffset = 0;
    memoriesOffset = 0;
    
    // Load data for the selected tab
    if (tab === 'files') {
        loadFiles(true);
    } else if (tab === 'memories') {
        // Hide memory form and show list when switching to memories tab
        document.getElementById('memoryForm').style.display = 'none';
        document.getElementById('memoriesList').style.display = 'block';
        document.getElementById('memoryActions').style.display = 'flex';
        loadMemories(true);
    } else if (tab === 'urls') {
        await loadURLs();
    }
}

// Load files from server
async function loadFiles(reset = true) {
    try {
        if (reset) {
            filesOffset = 0;
            currentFiles = [];
            allFilesLoaded = false;
        }
        
        const response = await fetch('/api/files');
        const data = await response.json();
        
        if (data.success) {
            const allFiles = data.files;
            
            // Implement client-side pagination
            const startIndex = filesOffset;
            const endIndex = Math.min(startIndex + FILES_PER_PAGE, allFiles.length);
            
            if (reset) {
                currentFiles = allFiles.slice(0, endIndex);
            } else {
                currentFiles = currentFiles.concat(allFiles.slice(startIndex, endIndex));
            }
            
            displayFiles(reset);
            
            // Show/hide load more button
            const loadMoreBtn = document.getElementById('loadMoreFilesBtn');
            allFilesLoaded = endIndex >= allFiles.length;
            loadMoreBtn.style.display = allFilesLoaded ? 'none' : 'block';
        }
    } catch (error) {
        console.error('Failed to load files:', error);
        showTranslatedNotification('notifications.failedToLoadFiles', 'error');
    }
}

// Load more files
function loadMoreFiles() {
    filesOffset += FILES_PER_PAGE;
    loadFiles(false);
}

// Display files
function displayFiles(reset = true) {
    const filesList = document.getElementById('filesList');
    
    if (reset) {
        filesList.innerHTML = '';
    }
    
    // Only display new files when loading more
    const startIndex = reset ? 0 : filesOffset;
    const endIndex = currentFiles.length;
    
    for (let i = startIndex; i < endIndex; i++) {
        const file = currentFiles[i];
        const row = document.createElement('div');
        row.className = 'file-row';
        row.dataset.filename = file.name;
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.textContent = file.name;
        
        const statusSpan = document.createElement('span');
        statusSpan.className = 'file-status';
        
        if (file.indexing) {
            statusSpan.innerHTML = '<div class="indexing-spinner"></div>';
        } else if (file.indexed) {
            statusSpan.innerHTML = '<span class="status-icon indexed">✓</span>';
        } else {
            statusSpan.innerHTML = '<span class="status-icon not-indexed">✗</span>';
        }
        
        row.appendChild(nameSpan);
        row.appendChild(statusSpan);
        filesList.appendChild(row);
    }
    
    updateFileActionButtons();
}

// Handle file selection
function handleFileSelection(e) {
    const row = e.target.closest('.file-row');
    if (!row) return;
    
    const filename = row.dataset.filename;
    
    if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        if (selectedFiles.has(filename)) {
            selectedFiles.delete(filename);
            row.classList.remove('selected');
        } else {
            selectedFiles.add(filename);
            row.classList.add('selected');
        }
    } else if (e.shiftKey && selectedFiles.size > 0) {
        // Range selection
        const allRows = Array.from(document.querySelectorAll('.file-row'));
        const clickedIndex = allRows.indexOf(row);
        let lastSelectedIndex = -1;
        
        // Find last selected item
        allRows.forEach((r, i) => {
            if (r.classList.contains('selected')) {
                lastSelectedIndex = i;
            }
        });
        
        if (lastSelectedIndex !== -1) {
            const start = Math.min(clickedIndex, lastSelectedIndex);
            const end = Math.max(clickedIndex, lastSelectedIndex);
            
            for (let i = start; i <= end; i++) {
                const r = allRows[i];
                selectedFiles.add(r.dataset.filename);
                r.classList.add('selected');
            }
        }
    } else {
        // Single selection
        selectedFiles.clear();
        document.querySelectorAll('.file-row.selected').forEach(r => {
            r.classList.remove('selected');
        });
        selectedFiles.add(filename);
        row.classList.add('selected');
    }
    
    updateFileActionButtons();
}

// Update file action buttons
function updateFileActionButtons() {
    const deleteBtn = document.getElementById('deleteFilesBtn');
    deleteBtn.disabled = selectedFiles.size === 0;
}

// Handle file upload
async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    const formData = new FormData();
    files.forEach(file => {
        formData.append('files', file);
    });
    
    try {
        showTranslatedNotification('notifications.uploadingFiles', 'info');
        
        const response = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            showTranslatedNotification('notifications.fileUploaded', 'success');
            // Reload files to show indexing progress
            await loadFiles();
            
            // Start polling for indexing status
            pollIndexingStatus(data.uploadedFiles);
        } else {
            showTranslatedNotification('notifications.failedToUploadFiles', 'error');
        }
    } catch (error) {
        console.error('Failed to upload files:', error);
        showTranslatedNotification('notifications.failedToUploadFiles', 'error');
    }
    
    // Clear the input
    e.target.value = '';
}

// Poll for indexing status
async function pollIndexingStatus(filenames) {
    const pollInterval = setInterval(async () => {
        try {
            const response = await fetch('/api/files');
            const data = await response.json();
            
            if (data.success) {
                currentFiles = data.files;
                displayFiles();
                
                // Check if all files are done indexing
                const stillIndexing = filenames.some(filename => {
                    const file = currentFiles.find(f => f.name === filename);
                    return file && file.indexing;
                });
                
                if (!stillIndexing) {
                    clearInterval(pollInterval);
                }
            }
        } catch (error) {
            console.error('Failed to poll indexing status:', error);
            clearInterval(pollInterval);
        }
    }, 1000);
    
    // Stop polling after 30 seconds
    setTimeout(() => clearInterval(pollInterval), 30000);
}

// Delete selected files
async function deleteSelectedFiles() {
    if (selectedFiles.size === 0) return;
    
    const count = selectedFiles.size;
    const confirmMsg = count === 1 
        ? 'Are you sure you want to delete this file?' 
        : `Are you sure you want to delete ${count} files?`;
    
    if (!confirm(confirmMsg)) return;
    
    try {
        const response = await fetch('/api/files/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filenames: Array.from(selectedFiles) })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            if (data.errors && data.errors.length > 0) {
                const errorMsg = data.errors.map(e => `${e.filename}: ${e.error}`).join('\n');
                showTranslatedNotification('notifications.filesDeletedWithErrors', 'warning', { count: data.deletedCount, errors: errorMsg });
            } else {
                showTranslatedNotification('notifications.filesDeleted', 'success', { count: data.deletedCount });
            }
            selectedFiles.clear();
            await loadFiles();
        } else {
            showTranslatedNotification('notifications.failedToDeleteFiles', 'error');
        }
    } catch (error) {
        console.error('Failed to delete files:', error);
        showTranslatedNotification('notifications.failedToDeleteFiles', 'error');
    }
}

// Load memories
async function loadMemories(reset = true) {
    try {
        if (reset) {
            memoriesOffset = 0;
            currentMemories = [];
            selectedMemories.clear();
        }
        
        const response = await fetch(`/api/memories?offset=${memoriesOffset}&limit=${MEMORIES_PER_PAGE}`);
        const data = await response.json();
        
        if (data.success) {
            currentMemories = currentMemories.concat(data.memories);
            displayMemories(reset);
            
            // Show/hide load more button
            const loadMoreBtn = document.getElementById('loadMoreMemoriesBtn');
            loadMoreBtn.style.display = data.hasMore ? 'block' : 'none';
        }
    } catch (error) {
        console.error('Failed to load memories:', error);
        showTranslatedNotification('notifications.failedToLoadMemories', 'error');
    }
}

// Display memories
function displayMemories(reset = true) {
    const memoriesList = document.getElementById('memoriesList');
    
    if (reset) {
        memoriesList.innerHTML = '';
    }
    
    // Only display new memories (from current offset)
    const startIndex = reset ? 0 : memoriesOffset;
    const endIndex = currentMemories.length;
    
    for (let i = startIndex; i < endIndex; i++) {
        const memory = currentMemories[i];
        const row = document.createElement('div');
        row.className = 'memory-row';
        row.dataset.memoryIndex = i;
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'memory-title';
        titleSpan.textContent = memory.title;
        
        const dateSpan = document.createElement('span');
        dateSpan.className = 'memory-date';
        dateSpan.textContent = new Date(memory.date).toLocaleDateString();
        
        row.appendChild(titleSpan);
        row.appendChild(dateSpan);
        memoriesList.appendChild(row);
    }
    
    updateMemoryActionButtons();
}

// Handle memory selection
function handleMemorySelection(e) {
    const row = e.target.closest('.memory-row');
    if (!row) return;
    
    const index = parseInt(row.dataset.memoryIndex);
    
    if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        if (selectedMemories.has(index)) {
            selectedMemories.delete(index);
            row.classList.remove('selected');
        } else {
            selectedMemories.add(index);
            row.classList.add('selected');
        }
    } else if (e.shiftKey && selectedMemories.size > 0) {
        // Range selection
        const allRows = Array.from(document.querySelectorAll('.memory-row'));
        const clickedIndex = allRows.indexOf(row);
        let lastSelectedIndex = -1;
        
        // Find last selected item
        allRows.forEach((r, i) => {
            if (r.classList.contains('selected')) {
                lastSelectedIndex = i;
            }
        });
        
        if (lastSelectedIndex !== -1) {
            const start = Math.min(clickedIndex, lastSelectedIndex);
            const end = Math.max(clickedIndex, lastSelectedIndex);
            
            for (let i = start; i <= end; i++) {
                const r = allRows[i];
                selectedMemories.add(parseInt(r.dataset.memoryIndex));
                r.classList.add('selected');
            }
        }
    } else {
        // Single selection
        selectedMemories.clear();
        document.querySelectorAll('.memory-row.selected').forEach(r => {
            r.classList.remove('selected');
        });
        selectedMemories.add(index);
        row.classList.add('selected');
    }
    
    updateMemoryActionButtons();
}

// Update memory action buttons
function updateMemoryActionButtons() {
    const deleteBtn = document.getElementById('deleteMemoriesBtn');
    const editBtn = document.getElementById('editMemoryBtn');
    
    deleteBtn.disabled = selectedMemories.size === 0;
    editBtn.disabled = selectedMemories.size !== 1;
}

// Load more memories
function loadMoreMemories() {
    memoriesOffset += MEMORIES_PER_PAGE;
    loadMemories(false);
}

// Show memory form
function showMemoryForm(memory = null) {
    editingMemory = memory;
    
    const form = document.getElementById('memoryForm');
    const list = document.getElementById('memoriesList');
    const actions = document.getElementById('memoryActions');
    
    // Clear form
    document.getElementById('memoryTitle').value = memory ? memory.title : '';
    document.getElementById('memoryDate').value = memory ? memory.date : new Date().toISOString().split('T')[0];
    document.getElementById('memoryTags').value = memory ? memory.tags.join(', ') : '';
    document.getElementById('memoryText').value = memory ? memory.text : '';
    
    // Show form, hide list
    form.style.display = 'block';
    list.style.display = 'none';
    actions.style.display = 'none';
    document.getElementById('loadMoreMemoriesBtn').style.display = 'none';
}

// Hide memory form
function hideMemoryForm() {
    const form = document.getElementById('memoryForm');
    const list = document.getElementById('memoriesList');
    const actions = document.getElementById('memoryActions');
    
    form.style.display = 'none';
    list.style.display = 'block';
    actions.style.display = 'flex';
    
    // Show load more button if there are more memories
    const loadMoreBtn = document.getElementById('loadMoreMemoriesBtn');
    if (loadMoreBtn.style.display !== 'none') {
        loadMoreBtn.style.display = 'block';
    }
    
    editingMemory = null;
}

// Edit selected memory
function editSelectedMemory() {
    if (selectedMemories.size !== 1) return;
    
    const index = Array.from(selectedMemories)[0];
    const memory = currentMemories[index];
    showMemoryForm(memory);
}

// Save memory
async function saveMemory() {
    const title = document.getElementById('memoryTitle').value.trim();
    const date = document.getElementById('memoryDate').value;
    const tags = document.getElementById('memoryTags').value
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    const text = document.getElementById('memoryText').value.trim();
    
    if (!title || !date || !text) {
        showTranslatedNotification('notifications.pleaseFillRequiredFields', 'error');
        return;
    }
    
    const memoryData = {
        title,
        date,
        tags,
        text
    };
    
    try {
        let response;
        if (editingMemory) {
            // Update existing memory
            const index = currentMemories.indexOf(editingMemory);
            response = await fetch(`/api/memories/${index}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(memoryData)
            });
        } else {
            // Create new memory
            response = await fetch('/api/memories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(memoryData)
            });
        }
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showTranslatedNotification(editingMemory ? 'notifications.memoryUpdated' : 'notifications.memoryAdded', 'success');
            hideMemoryForm();
            memoriesOffset = 0; // Reset to beginning
            await loadMemories(true);
        } else {
            showTranslatedNotification('notifications.failedToSaveMemory', 'error');
        }
    } catch (error) {
        console.error('Failed to save memory:', error);
        showTranslatedNotification('notifications.failedToSaveMemory', 'error');
    }
}

// Delete selected memories
async function deleteSelectedMemories() {
    if (selectedMemories.size === 0) return;
    
    const count = selectedMemories.size;
    const confirmMsg = count === 1 
        ? 'Are you sure you want to delete this memory?' 
        : `Are you sure you want to delete ${count} memories?`;
    
    if (!confirm(confirmMsg)) return;
    
    try {
        // Convert indices to array and sort descending
        const indices = Array.from(selectedMemories).sort((a, b) => b - a);
        
        const response = await fetch('/api/memories/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ indices })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showTranslatedNotification('notifications.memoriesDeleted', 'success', { count: data.deletedCount });
            selectedMemories.clear();
            memoriesOffset = 0; // Reset to beginning
            await loadMemories(true);
        } else {
            showTranslatedNotification('notifications.failedToDeleteMemories', 'error');
        }
    } catch (error) {
        console.error('Failed to delete memories:', error);
        showTranslatedNotification('notifications.failedToDeleteMemories', 'error');
    }
}

// Socket.io listeners for real-time updates
function setupSocketListeners() {
    if (window.socket) {
        window.socket.on('file-indexing-progress', (data) => {
            if (currentTab === 'files') {
                const file = currentFiles.find(f => f.name === data.filename);
                if (file) {
                    file.indexing = data.status === 'indexing';
                    file.indexed = data.status === 'completed';
                    displayFiles();
                }
            }
        });
    }
}

// Load indexed URLs
async function loadURLs() {
    try {
        urlsLoading = true;
        document.getElementById('urls-loading').style.display = 'block';
        document.getElementById('urls-list').style.display = 'none';
        document.getElementById('no-urls').style.display = 'none';
        
        const response = await fetch('/api/urls');
        const data = await response.json();
        
        if (data.success) {
            currentURLs = data.urls || [];
            displayURLs();
        } else {
            console.error('Failed to load URLs:', data.error);
            showURLError('Failed to load indexed URLs');
        }
    } catch (error) {
        console.error('Failed to load URLs:', error);
        showURLError('Failed to load indexed URLs');
    } finally {
        urlsLoading = false;
        document.getElementById('urls-loading').style.display = 'none';
    }
}

// Display URLs list
function displayURLs() {
    const urlsList = document.getElementById('urls-list');
    const noUrls = document.getElementById('no-urls');
    const urlCount = document.getElementById('url-count');
    
    urlCount.textContent = currentURLs.length;
    
    if (currentURLs.length === 0) {
        urlsList.style.display = 'none';
        noUrls.style.display = 'flex';
        return;
    }
    
    urlsList.style.display = 'block';
    noUrls.style.display = 'none';
    
    urlsList.innerHTML = currentURLs.map(urlInfo => {
        const truncatedUrl = urlInfo.url.length > 60 
            ? urlInfo.url.substring(0, 60) + '...' 
            : urlInfo.url;
        
        const indexedDate = new Date(urlInfo.indexed_at).toLocaleDateString();
        
        return `
            <div class="url-item" data-key="${urlInfo.key}">
                <div class="url-info">
                    <div class="url-title">
                        <i class="fas fa-link"></i>
                        <strong>${escapeHtml(urlInfo.title || 'Untitled')}</strong>
                    </div>
                    <div class="url-link">
                        <a href="${urlInfo.url}" target="_blank" rel="noopener noreferrer" 
                           title="${urlInfo.url}">
                            ${escapeHtml(truncatedUrl)}
                            <i class="fas fa-external-link-alt" style="font-size: 10px; margin-left: 4px;"></i>
                        </a>
                    </div>
                    <div class="url-meta">
                        <span><i class="fas fa-calendar"></i> Indexed: ${indexedDate}</span>
                        <span><i class="fas fa-file-alt"></i> ${urlInfo.chunks} chunks</span>
                    </div>
                </div>
                <div class="url-actions">
                    <button class="url-action-btn refresh-url" 
                            data-key="${urlInfo.key}" 
                            title="Re-fetch and update">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button class="url-action-btn remove-url" 
                            data-key="${urlInfo.key}" 
                            title="Remove from index">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // Add event listeners for the buttons
    addURLEventListeners();
}

// Add URL to index
async function addURL() {
    const urlInput = document.getElementById('url-input');
    const url = urlInput.value.trim();
    
    if (!url) {
        showURLError('Please enter a URL');
        return;
    }
    
    // Basic URL validation
    try {
        new URL(url);
    } catch (e) {
        showURLError('Please enter a valid URL (e.g., https://example.com/article)');
        return;
    }
    
    const addBtn = document.getElementById('add-url-btn');
    const originalContent = addBtn.innerHTML;
    
    try {
        addBtn.disabled = true;
        addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Indexing...';
        hideURLError();
        
        const response = await fetch('/api/urls/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showTranslatedNotification('notifications.urlIndexed', 'success');
            urlInput.value = '';
            await loadURLs(); // Reload the list
        } else {
            showURLError(data.error || 'Failed to index URL');
        }
    } catch (error) {
        console.error('Failed to add URL:', error);
        showURLError('Failed to index URL. Please try again.');
    } finally {
        addBtn.disabled = false;
        addBtn.innerHTML = originalContent;
    }
}

// Refresh URL
async function refreshURL(key) {
    const urlItem = document.querySelector(`.url-item[data-key="${key}"]`);
    if (!urlItem) return;
    
    const refreshBtn = urlItem.querySelector('.refresh-url');
    const originalContent = refreshBtn.innerHTML;
    
    try {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        const response = await fetch(`/api/urls/${key}/refresh`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showTranslatedNotification('notifications.urlRefreshed', 'success');
            await loadURLs();
        } else {
            showURLError(data.error || 'Failed to refresh URL');
        }
    } catch (error) {
        console.error('Failed to refresh URL:', error);
        showURLError('Failed to refresh URL');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = originalContent;
    }
}

// Remove URL
async function removeURL(key) {
    const urlInfo = currentURLs.find(u => u.key === key);
    if (!urlInfo) return;
    
    if (!confirm(`Are you sure you want to remove this URL from the index?\n\n${urlInfo.url}`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/urls/${key}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showTranslatedNotification('notifications.urlRemoved', 'success');
            await loadURLs();
        } else {
            showURLError(data.error || 'Failed to remove URL');
        }
    } catch (error) {
        console.error('Failed to remove URL:', error);
        showURLError('Failed to remove URL');
    }
}

// Add event listeners for URL action buttons
function addURLEventListeners() {
    // Refresh buttons
    document.querySelectorAll('.refresh-url').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            refreshURL(btn.dataset.key);
        });
    });
    
    // Remove buttons
    document.querySelectorAll('.remove-url').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeURL(btn.dataset.key);
        });
    });
}

// Show/hide URL error messages
function showURLError(message) {
    const errorElement = document.getElementById('url-error-message');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            hideURLError();
        }, 5000);
    }
}

function hideURLError() {
    const errorElement = document.getElementById('url-error-message');
    if (errorElement) {
        errorElement.style.display = 'none';
    }
}

// Utility function to escape HTML (add only if not already present)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}