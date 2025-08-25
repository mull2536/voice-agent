// Settings UI management
class SettingsManager {
    constructor(api) {
        this.api = api;
        this.modal = document.getElementById('settings-modal');
        this.settings = {};
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Close button
        document.getElementById('close-settings').addEventListener('click', () => {
            this.close();
        });

        // Click outside to close
        this.modal.addEventListener('click', (event) => {
            if (event.target === this.modal) {
                this.close();
            }
        });
        
        // Save button
        document.getElementById('save-settings').addEventListener('click', () => {
            this.saveSettings();
        });
        
        // Tab switching
        const tabButtons = this.modal.querySelectorAll('.tab-btn');
        const tabContents = this.modal.querySelectorAll('.tab-content');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                
                // Update active states
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                button.classList.add('active');
                document.getElementById(`${targetTab}-tab`).classList.add('active');
            });
        });
        
        // Fixed seed toggle
        const useFixedSeed = document.getElementById('use-fixed-seed');
        const fixedSeedContainer = document.getElementById('fixed-seed-container');
        
        if (useFixedSeed) {
            useFixedSeed.addEventListener('change', (e) => {
                fixedSeedContainer.style.display = e.target.checked ? 'block' : 'none';
            });
        }
        
        // Add TTS model change listener (add this after the fixed seed toggle listener)
        const ttsModelSelect = document.getElementById('tts-model');
        if (ttsModelSelect) {
            ttsModelSelect.addEventListener('change', (e) => {
                const isV3 = e.target.value === 'eleven_v3';
                
                // Toggle visibility of non-v3 settings
                const similarityBoostItem = document.getElementById('similarity-boost')?.closest('.setting-item');
                const styleItem = document.getElementById('style-exaggeration')?.closest('.setting-item');
                
                if (isV3) {
                    if (similarityBoostItem) similarityBoostItem.style.display = 'none';
                    if (styleItem) styleItem.style.display = 'none';
                } else {
                    if (similarityBoostItem) similarityBoostItem.style.display = '';
                    if (styleItem) styleItem.style.display = '';
                }
            });
        }
        
        // Range inputs - show value
        const rangeInputs = this.modal.querySelectorAll('input[type="range"]');
        rangeInputs.forEach(input => {
            input.addEventListener('input', (e) => {
                const valueDisplay = e.target.parentElement.querySelector('.value-display');
                if (valueDisplay) {
                    const value = e.target.value;
                    
                    // Format based on input ID
                    switch(e.target.id) {
                        case 'hover-duration':
                            valueDisplay.textContent = `${value}s`;
                            break;
                        case 'speech-rate':
                            valueDisplay.textContent = `${value}x`;
                            break;
                        case 'positive-threshold':
                        case 'negative-threshold':
                        case 'stability':
                        case 'similarity-boost':
                        case 'style-exaggeration':
                        case 'temperature':
                            valueDisplay.textContent = value;
                            break;
                        case 'min-speech-frames':
                        case 'pre-speech-pad':
                        case 'redemption-frames':
                            valueDisplay.textContent = value;
                            break;
                        default:
                            valueDisplay.textContent = value;
                    }
                }
            });
            
            // Trigger initial update
            input.dispatchEvent(new Event('input'));
        });
        
        // Expandable system prompt functionality
        this.setupExpandablePrompt();
    }
    
    async open() {
        // Show the modal first
        this.modal.classList.add('active');
        
        // Load latest settings
        try {
            const response = await this.api.getSettings();
            this.loadSettings(response.settings);
            
            // Load languages
            await this.loadLanguages();
            
            // Load voices
            const voicesResponse = await this.api.getVoices();
            this.loadVoices(voicesResponse);
            
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }
    
    close() {
        this.modal.classList.remove('active');
    }
    
    loadSettings(settings) {
        this.settings = settings;
        
        // Voice Tab Settings
        if (settings.tts) {
            const voiceSelect = document.getElementById('voice-select');
            const ttsModel = document.getElementById('tts-model');
            const outputQuality = document.getElementById('output-quality');
            const stability = document.getElementById('stability');
            const similarityBoost = document.getElementById('similarity-boost');
            const speechRate = document.getElementById('speech-rate');
            const styleExaggeration = document.getElementById('style-exaggeration');
            const speakerBoost = document.getElementById('speaker-boost');
            
            if (voiceSelect && settings.tts.voiceId) {
                voiceSelect.value = settings.tts.voiceId;
            }
            if (ttsModel && settings.tts.model) {
                ttsModel.value = settings.tts.model;
                // If v3 is already selected when loading, hide non-applicable settings
                if (settings.tts.model === 'eleven_v3') {
                    // Hide all non-v3 settings (v3 only uses stability and speaker boost)
                    document.getElementById('similarity-boost')?.closest('.setting-item')?.style.setProperty('display', 'none');
                    document.getElementById('style-exaggeration')?.closest('.setting-item')?.style.setProperty('display', 'none');
                    document.getElementById('speech-rate')?.closest('.setting-item')?.style.setProperty('display', 'none');
                    document.getElementById('use-fixed-seed')?.closest('.setting-item')?.style.setProperty('display', 'none');
                    document.getElementById('fixed-seed-container')?.style.setProperty('display', 'none');
                } else {
                    // Make sure they're visible for other models
                    document.getElementById('similarity-boost')?.closest('.setting-item')?.style.removeProperty('display');
                    document.getElementById('style-exaggeration')?.closest('.setting-item')?.style.removeProperty('display');
                    document.getElementById('speech-rate')?.closest('.setting-item')?.style.removeProperty('display');
                    document.getElementById('use-fixed-seed')?.closest('.setting-item')?.style.removeProperty('display');
                    // Fixed seed container visibility depends on checkbox state
                    const useFixedSeed = document.getElementById('use-fixed-seed');
                    if (useFixedSeed?.checked) {
                        document.getElementById('fixed-seed-container')?.style.removeProperty('display');
                    }
                }
            }
            if (outputQuality && settings.tts.outputQuality) {
                outputQuality.value = settings.tts.outputQuality;
            }
            if (stability && settings.tts.stability !== undefined) {
                stability.value = settings.tts.stability;
                stability.dispatchEvent(new Event('input'));
            }
            if (similarityBoost && settings.tts.similarityBoost !== undefined) {
                similarityBoost.value = settings.tts.similarityBoost;
                similarityBoost.dispatchEvent(new Event('input'));
            }
            if (speechRate && settings.tts.speechRate) {
                speechRate.value = settings.tts.speechRate;
                speechRate.dispatchEvent(new Event('input'));
            }
            if (styleExaggeration && settings.tts.style !== undefined) {
                styleExaggeration.value = settings.tts.style;
                styleExaggeration.dispatchEvent(new Event('input'));
            }
            if (speakerBoost) {
                speakerBoost.checked = settings.tts.useSpeakerBoost !== false;
            }
        }
        
        // Recorder Tab Settings
        // Transcription language
        if (settings.recorder && settings.recorder.transcriptionLanguage !== undefined) {
            const transcriptionLanguage = document.getElementById('transcription-language');
            if (transcriptionLanguage) {
                transcriptionLanguage.value = settings.recorder.transcriptionLanguage || 'auto';
            }
        }
        
        // VAD settings
        if (settings.vad) {
            const positiveThreshold = document.getElementById('positive-threshold');
            const negativeThreshold = document.getElementById('negative-threshold');
            const minSpeechFrames = document.getElementById('min-speech-frames');
            const preSpeechPad = document.getElementById('pre-speech-pad');
            const redemptionFrames = document.getElementById('redemption-frames');
            
            if (positiveThreshold && settings.vad.positiveSpeechThreshold !== undefined) {
                positiveThreshold.value = settings.vad.positiveSpeechThreshold;
                positiveThreshold.dispatchEvent(new Event('input'));
            }
            if (negativeThreshold && settings.vad.negativeSpeechThreshold !== undefined) {
                negativeThreshold.value = settings.vad.negativeSpeechThreshold;
                negativeThreshold.dispatchEvent(new Event('input'));
            }
            if (minSpeechFrames && settings.vad.minSpeechFrames !== undefined) {
                minSpeechFrames.value = settings.vad.minSpeechFrames;
                minSpeechFrames.dispatchEvent(new Event('input'));
            }
            if (preSpeechPad && settings.vad.preSpeechPadFrames !== undefined) {
                preSpeechPad.value = settings.vad.preSpeechPadFrames;
                preSpeechPad.dispatchEvent(new Event('input'));
            }
            if (redemptionFrames && settings.vad.redemptionFrames !== undefined) {
                redemptionFrames.value = settings.vad.redemptionFrames;
                redemptionFrames.dispatchEvent(new Event('input'));
            }
        }
        
        // LLM Tab Settings
        if (settings.llm) {
            const llmModel = document.getElementById('llm-model');
            const temperature = document.getElementById('temperature');
            const maxTokens = document.getElementById('max-tokens');
            const searchEnabled = document.getElementById('search-enabled');
            
            if (llmModel && settings.llm.model) {
                llmModel.value = settings.llm.model;
            }
            if (temperature && settings.llm.temperature !== undefined) {
                temperature.value = settings.llm.temperature;
                temperature.dispatchEvent(new Event('input'));
            }
            if (maxTokens && settings.llm.maxTokens) {
                maxTokens.value = settings.llm.maxTokens;
            }
            if (searchEnabled && settings.internetSearch) {
                searchEnabled.checked = settings.internetSearch.enabled !== false;
            }
        }
        
        // System Tab Settings
        const systemPrompt = document.getElementById('system-prompt');
        const hoverDuration = document.getElementById('hover-duration');
        const visualFeedback = document.getElementById('visual-feedback');
        const defaultLanguage = document.getElementById('default-language');
        const chunkSize = document.getElementById('chunk-size');
        const chunkOverlap = document.getElementById('chunk-overlap');
        const topKResults = document.getElementById('top-k-results');
        
        if (systemPrompt && settings.llm && settings.llm.systemPrompt) {
            systemPrompt.value = settings.llm.systemPrompt;
        }
        if (hoverDuration && settings.eyeGaze && settings.eyeGaze.hoverDuration) {
            hoverDuration.value = settings.eyeGaze.hoverDuration / 1000;
            hoverDuration.dispatchEvent(new Event('input'));
        }
        if (visualFeedback && settings.eyeGaze) {
            visualFeedback.checked = settings.eyeGaze.visualFeedback !== false;
        }
        // Enhanced language setting
        if (defaultLanguage && settings.system && settings.system.defaultLanguage) {
            setTimeout(() => {
                defaultLanguage.value = settings.system.defaultLanguage;
                
                const options = defaultLanguage.options;
                for (let i = 0; i < options.length; i++) {
                    if (options[i].value === settings.system.defaultLanguage) {
                        options[i].selected = true;
                        defaultLanguage.selectedIndex = i;
                        break;
                    }
                }
                
                defaultLanguage.dispatchEvent(new Event('change', { bubbles: true }));
            }, 100);
        }
        
        if (chunkSize && settings.rag && settings.rag.chunkSize) {
            chunkSize.value = settings.rag.chunkSize;
        }
        if (chunkOverlap && settings.rag && settings.rag.chunkOverlap) {
            chunkOverlap.value = settings.rag.chunkOverlap;
        }
        if (topKResults && settings.rag && settings.rag.topK) {
            topKResults.value = settings.rag.topK;
        }
    }

    async loadInitialLanguage() {
        try {
            // Try to get settings from the server
            const response = await this.api.getSettings();
            if (response.settings && response.settings.system && response.settings.system.defaultLanguage) {
                const defaultLanguage = document.getElementById('default-language');
                if (defaultLanguage) {
                    defaultLanguage.value = response.settings.system.defaultLanguage;
                    console.log('Initial language set to:', response.settings.system.defaultLanguage);
                }
            }
        } catch (error) {
            console.warn('Could not load initial language settings:', error);
        }
    }
    
    async loadLanguages() {
        try {
            // Fetch languages from API
            const response = await fetch('/api/settings/languages');
            const data = await response.json();
            
            if (!data.success || !data.languages) {
                console.error('Failed to load languages');
                return;
            }
            
            const languages = data.languages;
            
            // Populate system default language dropdown
            const defaultLanguageSelect = document.getElementById('default-language');
            if (defaultLanguageSelect) {
                defaultLanguageSelect.innerHTML = '';
                
                languages.forEach(lang => {
                    const option = document.createElement('option');
                    option.value = lang.code;
                    option.textContent = `${lang.name} (${lang.nativeName})`;
                    defaultLanguageSelect.appendChild(option);
                });
                
                // Set the current value if it exists
                if (this.settings?.system?.defaultLanguage) {
                    defaultLanguageSelect.value = this.settings.system.defaultLanguage;
                }
            }
            
            // Populate transcription language dropdown
            const transcriptionLanguageSelect = document.getElementById('transcription-language');
            if (transcriptionLanguageSelect) {
                transcriptionLanguageSelect.innerHTML = '';
                
                // Add automatic option first
                const autoOption = document.createElement('option');
                autoOption.value = 'auto';
                // Get translated text for "Automatic"
                const translationManager = window.app?.translationManager;
                if (translationManager) {
                    autoOption.textContent = translationManager.getTranslation('modals.settings.recorder.transcriptionLanguageAutomatic');
                } else {
                    autoOption.textContent = 'Automatic';
                }
                transcriptionLanguageSelect.appendChild(autoOption);
                
                // Add language options
                languages.forEach(lang => {
                    const option = document.createElement('option');
                    option.value = lang.code;
                    option.textContent = `${lang.name} (${lang.nativeName})`;
                    transcriptionLanguageSelect.appendChild(option);
                });
                
                // Set the current value if it exists
                if (this.settings?.recorder?.transcriptionLanguage) {
                    transcriptionLanguageSelect.value = this.settings.recorder.transcriptionLanguage;
                } else {
                    transcriptionLanguageSelect.value = 'auto';
                }
            }
            
        } catch (error) {
            console.error('Failed to load languages:', error);
        }
    }
    
    loadVoices(voicesData) {
        const voiceSelect = document.getElementById('voice-select');
        if (!voiceSelect) return;
        
        voiceSelect.innerHTML = '';
        
        // Handle the response structure
        let voices = [];
        if (voicesData && voicesData.voices) {
            voices = voicesData.voices;
        } else if (Array.isArray(voicesData)) {
            voices = voicesData;
        }
        
        // Check if we have voices
        if (voices.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No voices available';
            voiceSelect.appendChild(option);
            console.warn('No voices available from ElevenLabs');
            return;
        }
        
        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '-- Select a voice --';
        voiceSelect.appendChild(defaultOption);
        
        // Add voices
        voices.forEach(voice => {
            const option = document.createElement('option');
            // ElevenLabs API returns voice_id (with underscore)
            option.value = voice.voice_id || voice.voiceId || '';
            
            // Create descriptive label
            let label = voice.name || 'Unnamed Voice';
            if (voice.category) {
                label += ` (${voice.category})`;
            }
            
            option.textContent = label;
            
            // Check if currently selected
            if (this.settings.tts && this.settings.tts.voiceId && 
                (this.settings.tts.voiceId === voice.voice_id || 
                 this.settings.tts.voiceId === voice.voiceId)) {
                option.selected = true;
            }
            
            voiceSelect.appendChild(option);
        });
        
        // Try to select saved voice if not already selected
        if (!voiceSelect.value && this.settings.tts && this.settings.tts.voiceId) {
            voiceSelect.value = this.settings.tts.voiceId;
        }
    }
    
    async saveSettings() {
        try {
            const updates = {};
            
            // Collect Voice settings
            const voiceSelectElement = document.getElementById('voice-select');
            const selectedVoiceId = voiceSelectElement ? voiceSelectElement.value : '';

            // If no voice is selected, log a warning
            if (!selectedVoiceId) {
                console.warn('No voice selected in settings');
            }

            // Check which elements exist
            console.log('Checking elements:');
            console.log('voice-select:', document.getElementById('voice-select'));
            console.log('tts-model:', document.getElementById('tts-model'));
            console.log('use-fixed-seed:', document.getElementById('use-fixed-seed'));
            console.log('fixed-seed:', document.getElementById('fixed-seed'));
            updates.tts = {
                voiceId: selectedVoiceId || this.settings.tts?.voiceId || '',
                model: document.getElementById('tts-model')?.value || '',
                outputQuality: document.getElementById('output-quality')?.value || '',
                stability: parseFloat(document.getElementById('stability')?.value || '0.5'),
                similarityBoost: parseFloat(document.getElementById('similarity-boost')?.value || '0.75'),
                speechRate: parseFloat(document.getElementById('speech-rate')?.value || '1.0'),
                style: parseFloat(document.getElementById('style-exaggeration')?.value || '0'),
                useSpeakerBoost: document.getElementById('speaker-boost')?.checked || false,
                useFixedSeed: document.getElementById('use-fixed-seed')?.checked || false,
                fixedSeed: document.getElementById('use-fixed-seed')?.checked ? 
                           (parseInt(document.getElementById('fixed-seed')?.value || '0') || null) : null
            };
            
            // Collect Recorder settings
            const transcriptionLang = document.getElementById('transcription-language')?.value;
            updates.recorder = {
                transcriptionLanguage: transcriptionLang === 'auto' ? null : transcriptionLang
            };
            
            updates.vad = {
                positiveSpeechThreshold: parseFloat(document.getElementById('positive-threshold')?.value || '0.5'),
                negativeSpeechThreshold: parseFloat(document.getElementById('negative-threshold')?.value || '0.5'),
                minSpeechFrames: parseInt(document.getElementById('min-speech-frames')?.value || '10'),
                preSpeechPadFrames: parseInt(document.getElementById('pre-speech-pad')?.value || '10'),
                redemptionFrames: parseInt(document.getElementById('redemption-frames')?.value || '10')
            };
            
            // Collect LLM settings
            updates.llm = {
                model: document.getElementById('llm-model')?.value || 'gpt-4o-mini',
                temperature: parseFloat(document.getElementById('temperature')?.value || '0.7'),
                maxTokens: parseInt(document.getElementById('max-tokens')?.value || '150'),
                systemPrompt: document.getElementById('system-prompt')?.value || ''
            };
            
            // Collect Internet Search settings
            updates.internetSearch = {
                enabled: document.getElementById('search-enabled')?.checked || false
            };
            
            // Collect System settings
            updates.eyeGaze = {
                hoverDuration: parseFloat(document.getElementById('hover-duration')?.value || '3') * 1000,
                visualFeedback: document.getElementById('visual-feedback')?.checked || true
            };
            
            // Get the selected language
            const selectedLanguage = document.getElementById('default-language')?.value || 'en';

            // Save language to system settings only
            updates.system = {
                defaultLanguage: selectedLanguage
            };
            
            updates.rag = {
                chunkSize: parseInt(document.getElementById('chunk-size')?.value || '1000'),
                chunkOverlap: parseInt(document.getElementById('chunk-overlap')?.value || '200'),
                topK: parseInt(document.getElementById('top-k-results')?.value || '5')
            };
            
            // Save to server
            await this.api.updateSettings(updates);
            
            // Update local eye gaze settings if needed
            if (window.app && window.app.eyeGazeControls) {
                window.app.eyeGazeControls.updateSettings({
                    hoverDuration: parseFloat(document.getElementById('hover-duration')?.value || '3'),
                    visualFeedback: document.getElementById('visual-feedback')?.checked || true
                });
            }
            
            showTranslatedNotification('notifications.settingsSaved', 'success');
            
            // Close modal after short delay
            setTimeout(() => {
                this.close();
            }, 1500);
            
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showNotification('Failed to save settings', 'error');
        }
    }
    
    showNotification(message, type = 'info') {
        // Use the conversation UI notification system
        if (window.app && window.app.conversationUI) {
            window.app.conversationUI.showNotification(message, type);
        }
    }
    
    setupExpandablePrompt() {
        const expandBtn = document.getElementById('custom-expand-btn');
        const expandedModal = document.getElementById('expanded-prompt-modal');
        const closeExpandedBtn = document.getElementById('close-expanded-prompt');
        const saveExpandedBtn = document.getElementById('save-expanded-prompt');
        const systemPrompt = document.getElementById('system-prompt');
        const expandedPrompt = document.getElementById('expanded-system-prompt');
        
        if (!expandBtn || !expandedModal || !closeExpandedBtn || !saveExpandedBtn || !systemPrompt || !expandedPrompt) {
            console.warn('Some expandable prompt elements not found');
            return;
        }
        
        // Expand button click
        expandBtn.addEventListener('click', () => {
            // Copy current content to expanded textarea
            expandedPrompt.value = systemPrompt.value;
            
            // Show expanded modal
            expandedModal.classList.add('active');
            
            // Focus on the expanded textarea
            setTimeout(() => {
                expandedPrompt.focus();
            }, 100);
        });
        
        // Close button click
        closeExpandedBtn.addEventListener('click', () => {
            expandedModal.classList.remove('active');
        });
        
        // Click outside to close
        expandedModal.addEventListener('click', (event) => {
            if (event.target === expandedModal) {
                expandedModal.classList.remove('active');
            }
        });
        
        // Return to settings button click
        saveExpandedBtn.addEventListener('click', () => {
            // Copy content back to original textarea
            systemPrompt.value = expandedPrompt.value;
            
            // Close expanded modal
            expandedModal.classList.remove('active');
            
            // Note: Settings are not saved automatically - user needs to click "Save Settings" in the main settings modal
        });
        
        // Escape key to close
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && expandedModal.classList.contains('active')) {
                expandedModal.classList.remove('active');
            }
        });
    }
}