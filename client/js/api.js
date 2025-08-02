// API wrapper for server communication
class API {
    constructor() {
        this.baseURL = '/api';
    }
    
    async request(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.baseURL}${endpoint}`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }
    
    // Conversation endpoints
    async getRecentConversations(limit = 10) {
        return this.request(`/conversation/recent?limit=${limit}`);
    }
    
    async getConversationContext(personId = null, hoursBack = 24) {
        const params = new URLSearchParams();
        if (personId) params.append('personId', personId);
        params.append('hoursBack', hoursBack);
        return this.request(`/conversation/context?${params}`);
    }
    
    async searchConversations(query) {
        return this.request(`/conversation/search?query=${encodeURIComponent(query)}`);
    }
    
    async getConversationsByPerson(personId, limit = 50) {
        return this.request(`/conversation/by-person/${personId}?limit=${limit}`);
    }
    
    async getConversationStats() {
        return this.request('/conversation/stats');
    }
    
    async exportData() {
        const response = await fetch(`${this.baseURL}/conversation/export`);
        const blob = await response.blob();
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `smf-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    // Settings endpoints
    async getSettings() {
        return this.request('/settings');
    }
    
    async updateSettings(settings) {
        return this.request('/settings', {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
    }
    
    async updateSettingsCategory(category, settings) {
        return this.request(`/settings/${category}`, {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
    }
    
    async resetSettings(category = null) {
        return this.request('/settings/reset', {
            method: 'POST',
            body: JSON.stringify({ category })
        });
    }
    
    async getVoices() {
        return this.request('/settings/voices');
    }
    
    // People endpoints
    async getPeople() {
        return this.request('/people');
    }
    
    async addPerson(name, notes = '') {
        return this.request('/people', {
            method: 'POST',
            body: JSON.stringify({ name, notes })
        });
    }
    
    async updatePerson(id, updates) {
        return this.request(`/people/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
    }
    
    async deletePerson(id) {
        return this.request(`/people/${id}`, {
            method: 'DELETE'
        });
    }
    
    async getPersonContext(id) {
        return this.request(`/people/${id}/context`);
    }
}