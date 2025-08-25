// Translation Manager for SMF Voice Agent
class TranslationManager {
    constructor() {
        this.translations = {};
        this.currentLanguage = localStorage.getItem('appLanguage') || 'en';
        this.loadedLanguages = new Set();
    }

    async init() {
        // Load translations
        await this.loadTranslations();
        
        // Apply translations to the page
        this.applyTranslations();
        
        // Set up language change listeners
        this.setupLanguageListeners();
    }

    async loadTranslations() {
        try {
            const response = await fetch('/translations.json');
            this.translations = await response.json();
            console.log('Translations loaded successfully');
        } catch (error) {
            console.error('Failed to load translations:', error);
            // Fallback to English if loading fails
            this.currentLanguage = 'en';
        }
    }

    setLanguage(language) {
        if (this.translations[language]) {
            this.currentLanguage = language;
            localStorage.setItem('appLanguage', language);
            this.applyTranslations();
            
            // Emit language change event
            window.dispatchEvent(new CustomEvent('languageChanged', { 
                detail: { language } 
            }));
        } else {
            // Fallback to English if language not available in UI translations
            // This is OK since system language can be different from UI language
            if (language && language !== 'en') {
                console.info(`UI translations for ${language} not available, using English for interface`);
                this.currentLanguage = 'en';
                localStorage.setItem('appLanguage', 'en');
                this.applyTranslations();
            }
        }
    }

    getTranslation(key) {
        const keys = key.split('.');
        let translation = this.translations[this.currentLanguage];
        
        for (const k of keys) {
            if (translation && translation[k]) {
                translation = translation[k];
            } else {
                // Fallback to English if translation not found
                translation = this.getEnglishFallback(keys);
                break;
            }
        }
        
        return translation || key;
    }

    getEnglishFallback(keys) {
        let translation = this.translations['en'];
        for (const k of keys) {
            if (translation && translation[k]) {
                translation = translation[k];
            } else {
                return null;
            }
        }
        return translation;
    }

    applyTranslations() {
        // Update all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.getTranslation(key);
            
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                // For input elements, update placeholder
                if (element.hasAttribute('placeholder')) {
                    element.placeholder = translation;
                }
            } else if (element.tagName === 'IMG') {
                // For images, update alt text
                element.alt = translation;
            } else {
                // For other elements, update text content
                // Preserve any child elements (like icons)
                if (element.children.length === 0) {
                    element.textContent = translation;
                } else {
                    // Update only text nodes
                    const textNode = Array.from(element.childNodes)
                        .find(node => node.nodeType === Node.TEXT_NODE);
                    if (textNode) {
                        textNode.textContent = translation;
                    } else {
                        // If no text node, add one
                        element.insertAdjacentText('afterbegin', translation + ' ');
                    }
                }
            }
        });

        // Update document title
        document.title = this.getTranslation('app.title');
        
        // Update any dynamic content
        this.updateDynamicContent();
    }

    updateDynamicContent() {
        // Update header title
        const headerTitle = document.querySelector('.app-header h1');
        if (headerTitle) {
            headerTitle.textContent = this.getTranslation('app.title');
        }

        // Update current speaker indicator
        const speakerIndicator = document.getElementById('current-speaker');
        if (speakerIndicator) {
            // Check if we have the current person from the app
            if (window.app && window.app.currentPerson && window.app.currentPerson.name) {
                // Update with the translated "Talking to" message
                speakerIndicator.textContent = this.translate('notifications.nowTalkingTo', { 
                    name: window.app.currentPerson.name 
                });
            } else {
                // No person selected - use the translated "No one selected" message
                speakerIndicator.textContent = this.getTranslation('app.currentSpeaker');
            }
        }

        // Update welcome message
        const welcomeTitle = document.querySelector('.welcome-message h2');
        const welcomeText = document.querySelector('.welcome-message p');
        if (welcomeTitle) {
            welcomeTitle.textContent = this.getTranslation('app.welcomeTitle');
        }
        if (welcomeText) {
            welcomeText.textContent = this.getTranslation('app.welcomeMessage');
        }

        // Update response selection header
        const responseHeader = document.querySelector('.response-header h3');
        if (responseHeader) {
            responseHeader.textContent = this.getTranslation('app.chooseResponse');
        }

        // Update button texts
        this.updateButtonTexts();
        
        // Update modal contents if they're open
        this.updateModalContents();
    }

    updateButtonTexts() {
        // Recording button
        const recordBtn = document.getElementById('record-btn');
        if (recordBtn) {
            const isRecording = recordBtn.classList.contains('recording');
            const btnText = recordBtn.querySelector('span');
            if (btnText) {
                btnText.textContent = this.getTranslation(
                    isRecording ? 'buttons.stopRecording' : 'buttons.startRecording'
                );
            }
        }

        // Send button
        const sendBtn = document.querySelector('.send-btn span');
        if (sendBtn) {
            sendBtn.textContent = this.getTranslation('buttons.send');
        }

        // Speak message button
        const speakBtn = document.querySelector('.speak-text-btn');
        if (speakBtn) {
            const btnText = speakBtn.querySelector('span') || speakBtn;
            btnText.textContent = this.getTranslation('buttons.speakMessage');
        }
    }

    updateModalContents() {
        // Settings Modal
        this.updateSettingsModal();
        
        // People Modal
        this.updatePeopleModal();
        
        // File Manager Modal
        this.updateFileManagerModal();
        
        // Info Modal
        this.updateInfoModal();
        
        // Help Modal
        this.updateHelpModal();
    }

    updateSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (!modal || modal.style.display === 'none') return;

        // Update title
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = this.getTranslation('modals.settings.title');

        // Update tabs
        modal.querySelectorAll('.tab-btn').forEach(tab => {
            const tabName = tab.dataset.tab;
            tab.textContent = this.getTranslation(`modals.settings.tabs.${tabName}`);
        });

        // Update save button
        const saveBtn = modal.querySelector('.save-btn');
        if (saveBtn) saveBtn.textContent = this.getTranslation('buttons.saveSettings');

        // Update each tab content
        this.updateSettingsTabContent('voice');
        this.updateSettingsTabContent('recorder');
        this.updateSettingsTabContent('llm');
        this.updateSettingsTabContent('system');
    }

    updateSettingsTabContent(tabName) {
        const tabContent = document.getElementById(`${tabName}-tab`);
        if (!tabContent) return;

        // Update section headers and descriptions
        tabContent.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            element.textContent = this.getTranslation(key);
        });
    }

    updatePeopleModal() {
        const modal = document.getElementById('peopleModal');
        if (!modal || modal.style.display === 'none') return;

        // Update title
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = this.getTranslation('modals.people.title');

        // Update section headers
        const selectHeader = modal.querySelector('.people-section h3');
        if (selectHeader) selectHeader.textContent = this.getTranslation('modals.people.selectPerson');

        const addHeader = modal.querySelector('.add-person-section h3');
        if (addHeader) addHeader.textContent = this.getTranslation('modals.people.addNewPerson');

        // Update placeholder
        const nameInput = modal.querySelector('#newPersonName');
        if (nameInput) nameInput.placeholder = this.getTranslation('modals.people.personNamePlaceholder');

        // Update buttons
        const addBtn = modal.querySelector('#addPersonBtn');
        if (addBtn) addBtn.textContent = this.getTranslation('buttons.addPerson');

        const useBtn = modal.querySelector('#usePersonBtn');
        if (useBtn) useBtn.textContent = this.getTranslation('buttons.use');

        const editBtn = modal.querySelector('#editPersonBtn');
        if (editBtn) editBtn.textContent = this.getTranslation('buttons.edit');

        const deleteBtn = modal.querySelector('#deletePersonBtn');
        if (deleteBtn) deleteBtn.textContent = this.getTranslation('buttons.delete');
    }

    updateFileManagerModal() {
        const modal = document.getElementById('fileManagerModal');
        if (!modal || modal.style.display === 'none') return;

        // Update title
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = this.getTranslation('modals.fileManager.title');

        // Update tabs
        modal.querySelectorAll('.tab-btn').forEach(tab => {
            const tabName = tab.dataset.tab;
            tab.textContent = this.getTranslation(`modals.fileManager.tabs.${tabName}`);
        });

        // Update upload area
        const uploadText = modal.querySelector('.upload-area p');
        if (uploadText) uploadText.textContent = this.getTranslation('modals.fileManager.uploadInstructions');

        const supportedFormats = modal.querySelector('.supported-formats');
        if (supportedFormats) supportedFormats.textContent = this.getTranslation('modals.fileManager.supportedFormats');

        // Update buttons
        const uploadBtn = modal.querySelector('#uploadFilesBtn');
        if (uploadBtn) uploadBtn.textContent = this.getTranslation('buttons.upload');

        const addMemoryBtn = modal.querySelector('#addMemoryBtn');
        if (addMemoryBtn) addMemoryBtn.textContent = this.getTranslation('buttons.addMemory');
    }

    updateInfoModal() {
        const modal = document.getElementById('info-modal');
        if (!modal || modal.style.display === 'none') return;

        // Update all translatable content
        modal.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            element.textContent = this.getTranslation(key);
        });
    }

    updateHelpModal() {
        const modal = document.getElementById('help-modal');
        if (!modal || modal.style.display === 'none') return;

        // Update title
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = this.getTranslation('help.title');

        // Update navigation buttons
        modal.querySelectorAll('.help-nav-btn').forEach(btn => {
            const section = btn.dataset.section;
            btn.textContent = this.getTranslation(`help.navigation.${section}`);
        });

        // Update help content
        this.updateHelpContent();
    }

    updateHelpContent() {
        // This is a complex update that rebuilds the help content
        // based on the current language
        const sections = ['overview', 'gettingStarted', 'voiceRecording', 
                         'eyeGaze', 'people', 'knowledgeBase', 'settings', 
                         'troubleshooting'];

        sections.forEach(section => {
            const sectionElement = document.getElementById(`${section}-section`);
            if (!sectionElement) return;

            // Update section title
            const title = sectionElement.querySelector('h3');
            if (title) {
                title.textContent = this.getTranslation(`help.sections.${section}.title`);
            }

            // Update section content based on its structure
            this.updateHelpSectionContent(section, sectionElement);
        });
    }

    updateHelpSectionContent(section, element) {
        // This method would need to be customized for each section
        // For brevity, showing a general approach
        element.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = this.getTranslation(key);
            
            // Handle special cases like lists
            if (el.tagName === 'UL' || el.tagName === 'OL') {
                // Update list items
                el.querySelectorAll('li').forEach((li, index) => {
                    const itemKey = `${key}.${index + 1}`;
                    const itemTranslation = this.getTranslation(itemKey);
                    if (itemTranslation !== itemKey) {
                        li.textContent = itemTranslation;
                    }
                });
            } else {
                el.textContent = translation;
            }
        });
    }

    setupLanguageListeners() {
        // Listen for language changes from settings
        window.addEventListener('languageChanged', (e) => {
            console.log('Language changed to:', e.detail.language);
            this.applyTranslations();
        });

        // Listen for dynamic content updates
        window.addEventListener('contentUpdated', () => {
            this.applyTranslations();
        });
    }

    // Helper method to translate dynamic content
    translate(key, replacements = {}) {
        let translation = this.getTranslation(key);
        
        // Replace placeholders with values
        Object.keys(replacements).forEach(placeholder => {
            translation = translation.replace(
                new RegExp(`{${placeholder}}`, 'g'), 
                replacements[placeholder]
            );
        });
        
        return translation;
    }

    // Get current language
    getCurrentLanguage() {
        return this.currentLanguage;
    }

    // Get available languages
    getAvailableLanguages() {
        return Object.keys(this.translations);
    }
}

// Export for use in other modules
window.TranslationManager = TranslationManager;