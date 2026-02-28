const fs = require('fs');
const path = require('path');
const config = require('../config/config');

class KeyManager {
    constructor() {
        this.statusFile = path.join(__dirname, '../data/key_status.json');
        this.keys = this._loadKeys();
        this.keyStatus = this._loadStatus();
        this.currentKeyIndex = 0;

        // reconcile keys from config with status
        this._reconcileKeys();
    }

    _loadKeys() {
        const keys = config.ai.gemini.apiKeys || [];
        if (config.ai.gemini.apiKey) {
            keys.unshift(config.ai.gemini.apiKey);
        }
        // Deduplicate and filter empty
        return [...new Set(keys.filter(k => k))];
    }

    _loadStatus() {
        try {
            if (fs.existsSync(this.statusFile)) {
                const data = fs.readFileSync(this.statusFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('[KeyManager] Failed to load key status:', error.message);
        }
        return {};
    }

    _saveStatus() {
        try {
            const dataDir = path.dirname(this.statusFile);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(this.statusFile, JSON.stringify(this.keyStatus, null, 2));
        } catch (error) {
            console.error('[KeyManager] Failed to save key status:', error.message);
        }
    }

    _reconcileKeys() {
        // Ensure all current config keys have an entry in status
        this.keys.forEach(key => {
            if (!this.keyStatus[key]) {
                this.keyStatus[key] = {
                    status: 'active', // active, dead, temp_failed
                    lastUsed: 0,
                    failureCount: 0,
                    successCount: 0,
                    errors: []
                };
            }
        });
        this._saveStatus();
    }

    getWorkingKey() {
        // Prioritize:
        // 1. Active keys that have worked recently (sorted by lastUsed desc)
        // 2. Untried keys (never used)
        // 3. Temp failed keys (if enough time passed)

        const now = Date.now();
        const validKeys = this.keys.filter(key => {
            const status = this.keyStatus[key];
            if (!status) return true; // Should be covered by reconcile, but safe fallback

            if (status.status === 'dead') return false;

            if (status.status === 'temp_failed') {
                // Retry temp failed keys after 5 minutes
                if (now - status.lastFailed > 5 * 60 * 1000) {
                    console.log(`[KeyManager] Retrying temp_failed key ending in ...${key.slice(-4)}`);
                    return true;
                }
                return false;
            }

            return true;
        });

        if (validKeys.length === 0) {
            console.warn('[KeyManager] ⚠️ No valid keys available!');
            return null;
        }

        // Sort by last success timestamp (descending) to prefer recently working keys
        validKeys.sort((a, b) => {
            const statsA = this.keyStatus[a] || { lastSuccess: 0 };
            const statsB = this.keyStatus[b] || { lastSuccess: 0 };
            return (statsB.lastSuccess || 0) - (statsA.lastSuccess || 0);
        });

        // Simple rotation for load balancing among good keys? 
        // Or strictly stick to the best one? 
        // Let's stick to the best one but rotate if it fails.
        // Actually, let's look for the *next* available key relative to current rotation to distribute load
        // if we just return index 0 every time, we hammer one key.

        // Find the next VALID key after currentKeyIndex
        let foundKey = validKeys[0];

        // If we want to rotate through valid keys:
        // We can just pick the one with least usage recently? 
        // For simplicity: just return the first "valid" key which is sorted by success. 
        // If the top one fails, it will be marked failed and we'll get the next one next time.

        return foundKey;
    }

    markKeyWorking(key) {
        if (!this.keyStatus[key]) return;

        this.keyStatus[key].status = 'active';
        this.keyStatus[key].lastUsed = Date.now();
        this.keyStatus[key].lastSuccess = Date.now();
        this.keyStatus[key].successCount = (this.keyStatus[key].successCount || 0) + 1;
        this.keyStatus[key].failureCount = 0; // Reset failures on success
        this._saveStatus();
    }

    markKeyFailed(key, error) {
        const status = this.keyStatus[key] || {
            status: 'active',
            lastUsed: 0,
            failureCount: 0,
            successCount: 0,
            errors: []
        };

        // Analyze error to decide if hard fail or temp fail
        const errorMessage = error.message ? error.message.toLowerCase() : String(error).toLowerCase();
        const isQuota = errorMessage.includes('429') || errorMessage.includes('quota');
        const isInvalid = errorMessage.includes('400') || errorMessage.includes('api key not valid') || errorMessage.includes('api_key_invalid');
        const isNotFound = errorMessage.includes('404') || errorMessage.includes('not found');

        if (isInvalid) {
            status.status = 'dead';
        } else if (isQuota) {
            status.status = 'temp_failed';
            status.lastFailed = Date.now();
        } else if (isNotFound) {
            // Model not found = configuration error, not key error technically? 
            // But if it's key-specific permission, mark temp.
            // Actually 404 on model usually means the code is wrong, so keys shouldn't be blamed?
            // But for safety let's mark temp.
            status.status = 'temp_failed';
            status.lastFailed = Date.now();
        } else {
            status.status = 'temp_failed';
            status.lastFailed = Date.now();
        }

        status.failureCount++;
        status.errors.push({
            time: new Date().toISOString(),
            message: error.message || String(error)
        });

        // Keep error log short
        const msg = (error.message || '').toLowerCase();
        // 400: Bad Request (often invalid key)
        // 403: Forbidden (key expired or invalid)
        // 429: Too Many Requests (Quota) - usually we want to treat this as temp, 
        //      but if it happens constantly, maybe we should deprioritize it heavily.
        //      For now, let's treat Quota as temp.

        if (msg.includes('400') || msg.includes('key not valid') || msg.includes('api_key_invalid')) return true;
        if (msg.includes('403')) return true;

        return false;
    }

    getStats() {
        return {
            totalKeys: this.keys.length,
            activeKeys: this.keys.filter(k => this.keyStatus[k]?.status === 'active').length,
            deadKeys: this.keys.filter(k => this.keyStatus[k]?.status === 'dead').length,
            tempFailedKeys: this.keys.filter(k => this.keyStatus[k]?.status === 'temp_failed').length
        };
    }
}

module.exports = new KeyManager();
