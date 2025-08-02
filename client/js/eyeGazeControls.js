// Eye gaze control system
class EyeGazeControls {
    constructor() {
        this.targets = new Map();
        this.currentTarget = null;
        this.hoverTimer = null;
        this.hoverDuration = 3000; // Default 3 seconds
        this.visualFeedback = true;
        this.isEnabled = true;
        
        this.loadSettings();
    }
    
    init() {
        // Setup mouse tracking as a proxy for eye gaze
        document.addEventListener('mousemove', (e) => this.handleGazeMove(e));
        document.addEventListener('mouseleave', () => this.handleGazeLeave());
        
        console.log('Eye gaze controls initialized');
    }
    
    loadSettings() {
        // Load from localStorage or use defaults
        const savedSettings = localStorage.getItem('eyeGazeSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            this.hoverDuration = settings.hoverDuration || 3000;
            this.visualFeedback = settings.visualFeedback !== false;
        }
    }
    
    updateSettings(settings) {
        if (settings.hoverDuration !== undefined) {
            this.hoverDuration = settings.hoverDuration * 1000; // Convert to ms
        }
        if (settings.visualFeedback !== undefined) {
            this.visualFeedback = settings.visualFeedback;
        }
        
        // Save settings
        localStorage.setItem('eyeGazeSettings', JSON.stringify({
            hoverDuration: this.hoverDuration / 1000,
            visualFeedback: this.visualFeedback
        }));
    }
    
    addTarget(element, callback) {
        if (!element || !callback) return;
        
        const targetId = this.generateId();
        element.dataset.gazeTarget = targetId;
        
        this.targets.set(targetId, {
            element,
            callback,
            isActive: true
        });
        
        // Add visual indicator if enabled
        if (this.visualFeedback) {
            element.classList.add('gaze-target');
        }
    }
    
    removeTarget(element) {
        const targetId = element.dataset.gazeTarget;
        if (targetId && this.targets.has(targetId)) {
            this.targets.delete(targetId);
            delete element.dataset.gazeTarget;
            element.classList.remove('gaze-target', 'gaze-hover');
        }
    }
    
    clearTargets() {
        this.targets.forEach((target) => {
            target.element.classList.remove('gaze-target', 'gaze-hover');
            delete target.element.dataset.gazeTarget;
        });
        this.targets.clear();
        this.cancelHover();
    }
    
    handleGazeMove(event) {
        if (!this.isEnabled) return;
        
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const gazeTarget = this.findGazeTarget(element);
        
        if (gazeTarget) {
            if (this.currentTarget !== gazeTarget) {
                this.startHover(gazeTarget);
            }
        } else {
            if (this.currentTarget) {
                this.cancelHover();
            }
        }
    }
    
    handleGazeLeave() {
        if (this.currentTarget) {
            this.cancelHover();
        }
    }
    
    findGazeTarget(element) {
        // Check if element or any parent is a gaze target
        let current = element;
        while (current && current !== document.body) {
            if (current.dataset && current.dataset.gazeTarget) {
                const targetId = current.dataset.gazeTarget;
                const target = this.targets.get(targetId);
                if (target && target.isActive) {
                    return target;
                }
            }
            current = current.parentElement;
        }
        return null;
    }
    
    startHover(target) {
        // Cancel any existing hover
        this.cancelHover();
        
        this.currentTarget = target;
        
        // Add visual feedback
        if (this.visualFeedback) {
            target.element.classList.add('gaze-hover');
            this.showProgressIndicator(target.element);
        }
        
        // Start hover timer
        this.hoverTimer = setTimeout(() => {
            this.activateTarget(target);
        }, this.hoverDuration);
    }
    
    cancelHover() {
        if (this.hoverTimer) {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = null;
        }
        
        if (this.currentTarget) {
            if (this.visualFeedback) {
                this.currentTarget.element.classList.remove('gaze-hover');
                this.hideProgressIndicator(this.currentTarget.element);
            }
            this.currentTarget = null;
        }
    }
    
    activateTarget(target) {
        if (!target || !target.isActive) return;
        
        // Visual feedback for selection
        if (this.visualFeedback) {
            target.element.classList.add('selected');
            setTimeout(() => {
                target.element.classList.remove('selected');
            }, 500);
        }
        
        // Execute callback
        if (target.callback) {
            target.callback(target.element);
        }
        
        // Reset
        this.cancelHover();
    }
    
    showProgressIndicator(element) {
        // The CSS animation handles the progress indicator
        // This is where you could add additional visual feedback
    }
    
    hideProgressIndicator(element) {
        // Remove any additional visual feedback
    }
    
    enable() {
        this.isEnabled = true;
    }
    
    disable() {
        this.isEnabled = false;
        this.cancelHover();
    }
    
    generateId() {
        return `gaze-target-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Optional: Advanced eye tracking integration
class AdvancedEyeTracking extends EyeGazeControls {
    constructor() {
        super();
        this.calibrationPoints = [];
        this.isCalibrated = false;
    }
    
    async initializeEyeTracker() {
        // This would integrate with actual eye tracking hardware/software
        // For example, using WebGazer.js or Tobii SDK
        
        try {
            // Check if eye tracking API is available
            if (window.webgazer) {
                await this.setupWebGazer();
            } else {
                console.log('Eye tracking API not available, using mouse fallback');
            }
        } catch (error) {
            console.error('Failed to initialize eye tracker:', error);
        }
    }
    
    async setupWebGazer() {
        // WebGazer.js setup example
        window.webgazer
            .setGazeListener((data, timestamp) => {
                if (data) {
                    this.handleGazeData(data.x, data.y);
                }
            })
            .begin();
        
        // Hide video feed
        window.webgazer.showVideoPreview(false);
    }
    
    handleGazeData(x, y) {
        // Create synthetic mouse event for gaze position
        const event = new MouseEvent('mousemove', {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true
        });
        
        this.handleGazeMove(event);
    }
    
    async calibrate() {
        // Implement calibration routine
        console.log('Starting eye tracker calibration...');
        // This would show calibration points and collect data
    }
}