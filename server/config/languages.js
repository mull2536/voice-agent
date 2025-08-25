// server/config/languages.js
// All ElevenLabs supported languages (29 total)
const languages = {
    'en': { name: 'English', nativeName: 'English' },
    'ar': { name: 'Arabic', nativeName: 'العربية' },
    'bg': { name: 'Bulgarian', nativeName: 'Български' },
    'cs': { name: 'Czech', nativeName: 'Čeština' },
    'da': { name: 'Danish', nativeName: 'Dansk' },
    'de': { name: 'German', nativeName: 'Deutsch' },
    'el': { name: 'Greek', nativeName: 'Ελληνικά' },
    'es': { name: 'Spanish', nativeName: 'Español' },
    'fi': { name: 'Finnish', nativeName: 'Suomi' },
    'tl': { name: 'Filipino', nativeName: 'Filipino' },
    'fr': { name: 'French', nativeName: 'Français' },
    'hi': { name: 'Hindi', nativeName: 'हिन्दी' },
    'hr': { name: 'Croatian', nativeName: 'Hrvatski' },
    'id': { name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
    'it': { name: 'Italian', nativeName: 'Italiano' },
    'ja': { name: 'Japanese', nativeName: '日本語' },
    'ko': { name: 'Korean', nativeName: '한국어' },
    'ms': { name: 'Malay', nativeName: 'Bahasa Melayu' },
    'nl': { name: 'Dutch', nativeName: 'Nederlands' },
    'pl': { name: 'Polish', nativeName: 'Polski' },
    'pt': { name: 'Portuguese', nativeName: 'Português' },
    'ro': { name: 'Romanian', nativeName: 'Română' },
    'ru': { name: 'Russian', nativeName: 'Русский' },
    'sk': { name: 'Slovak', nativeName: 'Slovenčina' },
    'sv': { name: 'Swedish', nativeName: 'Svenska' },
    'ta': { name: 'Tamil', nativeName: 'தமிழ்' },
    'tr': { name: 'Turkish', nativeName: 'Türkçe' },
    'uk': { name: 'Ukrainian', nativeName: 'Українська' },
    'zh': { name: 'Chinese', nativeName: '中文' }
};

module.exports = {
    languages,
    
    getLanguageInfo(code) {
        return this.languages[code] || this.languages['en'];
    },
    
    getSupportedLanguages() {
        return Object.keys(this.languages);
    },
    
    isSupported(code) {
        return code in this.languages;
    }
};