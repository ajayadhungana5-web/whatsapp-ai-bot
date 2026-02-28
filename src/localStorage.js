const fs = require('fs');
const path = require('path');

/**
 * Enhanced Local Storage System
 * Manages persistent data with auto-backup, cleanup, and optimization
 */
class LocalStorage {
    constructor(dataDir = './data') {
        this.dataDir = dataDir;
        this.memory = new Map();  // In-memory cache
        this.stats = {
            reads: 0,
            writes: 0,
            lastBackup: Date.now(),
            dataSize: 0
        };
        
        // Ensure data directory exists
        this.ensureDataDir();
        
        // Load existing data
        this.loadAllData();
        
        // Start auto-backup
        this.startAutoBackup();
        
        // Start cleanup
        this.startAutoCleanup();
        
        console.log('[LocalStorage] Initialized. Data dir:', this.dataDir);
    }

    ensureDataDir() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        
        // Create subdirectories
        const subdirs = ['conversations', 'backups', 'logs', 'analytics', 'cache'];
        for (const subdir of subdirs) {
            const fullPath = path.join(this.dataDir, subdir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
            }
        }
    }

    loadAllData() {
        try {
            // Load conversations
            const conversationsDir = path.join(this.dataDir, 'conversations');
            if (fs.existsSync(conversationsDir)) {
                const files = fs.readdirSync(conversationsDir);
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        const data = fs.readFileSync(path.join(conversationsDir, file), 'utf8');
                        const userId = file.replace('.json', '');
                        this.memory.set(`conversation_${userId}`, JSON.parse(data));
                    }
                }
                console.log(`[LocalStorage] Loaded ${files.length} conversation files`);
            }
            
            // Load analytics
            const analyticsFile = path.join(this.dataDir, 'analytics', 'analytics.json');
            if (fs.existsSync(analyticsFile)) {
                const data = fs.readFileSync(analyticsFile, 'utf8');
                this.memory.set('analytics', JSON.parse(data));
                console.log('[LocalStorage] Loaded analytics');
            }
            
            // Load learning data
            const learningFile = path.join(this.dataDir, 'learning.json');
            if (fs.existsSync(learningFile)) {
                const data = fs.readFileSync(learningFile, 'utf8');
                this.memory.set('learning', JSON.parse(data));
                console.log('[LocalStorage] Loaded learning data');
            }
            
        } catch (error) {
            console.error('[LocalStorage] Error loading data:', error.message);
        }
    }

    /**
     * Save conversation data
     */
    saveConversation(userId, conversationData) {
        try {
            const conversationsDir = path.join(this.dataDir, 'conversations');
            const filePath = path.join(conversationsDir, `${userId}.json`);
            
            // Add metadata
            const dataWithMeta = {
                ...conversationData,
                lastUpdated: Date.now(),
                version: 1
            };
            
            fs.writeFileSync(filePath, JSON.stringify(dataWithMeta, null, 2));
            this.memory.set(`conversation_${userId}`, dataWithMeta);
            this.stats.writes++;
            this.stats.dataSize = this.getDataSize();
            
            return true;
        } catch (error) {
            console.error('[LocalStorage] Error saving conversation:', error.message);
            return false;
        }
    }

    /**
     * Load conversation data
     */
    loadConversation(userId) {
        try {
            // Check memory first
            const memKey = `conversation_${userId}`;
            if (this.memory.has(memKey)) {
                this.stats.reads++;
                return this.memory.get(memKey);
            }
            
            // Load from disk
            const conversationsDir = path.join(this.dataDir, 'conversations');
            const filePath = path.join(conversationsDir, `${userId}.json`);
            
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(data);
                this.memory.set(memKey, parsed);
                this.stats.reads++;
                return parsed;
            }
            
            return null;
        } catch (error) {
            console.error('[LocalStorage] Error loading conversation:', error.message);
            return null;
        }
    }

    /**
     * Save analytics data
     */
    saveAnalytics(analyticsData) {
        try {
            const analyticsDir = path.join(this.dataDir, 'analytics');
            const filePath = path.join(analyticsDir, 'analytics.json');
            
            const dataWithMeta = {
                ...analyticsData,
                lastUpdated: Date.now()
            };
            
            fs.writeFileSync(filePath, JSON.stringify(dataWithMeta, null, 2));
            this.memory.set('analytics', dataWithMeta);
            this.stats.writes++;
            
            return true;
        } catch (error) {
            console.error('[LocalStorage] Error saving analytics:', error.message);
            return false;
        }
    }

    /**
     * Load analytics data
     */
    loadAnalytics() {
        try {
            if (this.memory.has('analytics')) {
                this.stats.reads++;
                return this.memory.get('analytics');
            }
            
            const analyticsDir = path.join(this.dataDir, 'analytics');
            const filePath = path.join(analyticsDir, 'analytics.json');
            
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(data);
                this.memory.set('analytics', parsed);
                this.stats.reads++;
                return parsed;
            }
            
            return { sessions: 0, messages: 0, avgResponseTime: 0, successRate: 0 };
        } catch (error) {
            console.error('[LocalStorage] Error loading analytics:', error.message);
            return {};
        }
    }

    /**
     * Save learning data
     */
    saveLearningData(learningData) {
        try {
            const filePath = path.join(this.dataDir, 'learning.json');
            
            fs.writeFileSync(filePath, JSON.stringify(learningData, null, 2));
            this.memory.set('learning', learningData);
            this.stats.writes++;
            
            return true;
        } catch (error) {
            console.error('[LocalStorage] Error saving learning data:', error.message);
            return false;
        }
    }

    /**
     * Load learning data
     */
    loadLearningData() {
        try {
            if (this.memory.has('learning')) {
                this.stats.reads++;
                return this.memory.get('learning');
            }
            
            const filePath = path.join(this.dataDir, 'learning.json');
            
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(data);
                this.memory.set('learning', parsed);
                this.stats.reads++;
                return parsed;
            }
            
            return { interactions: [], patterns: {}, userPreferences: {} };
        } catch (error) {
            console.error('[LocalStorage] Error loading learning data:', error.message);
            return {};
        }
    }

    /**
     * Save cache data for quick access
     */
    saveCache(key, value, ttl = null) {
        try {
            const cacheDir = path.join(this.dataDir, 'cache');
            const fileName = `${key.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
            const filePath = path.join(cacheDir, fileName);
            
            const data = {
                value,
                createdAt: Date.now(),
                ttl,
                expiresAt: ttl ? Date.now() + ttl : null
            };
            
            fs.writeFileSync(filePath, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('[LocalStorage] Error saving cache:', error.message);
            return false;
        }
    }

    /**
     * Load cache data
     */
    loadCache(key) {
        try {
            const cacheDir = path.join(this.dataDir, 'cache');
            const fileName = `${key.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
            const filePath = path.join(cacheDir, fileName);
            
            if (!fs.existsSync(filePath)) {
                return null;
            }
            
            const data = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(data);
            
            // Check if expired
            if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
                fs.unlinkSync(filePath);  // Delete expired cache
                return null;
            }
            
            return parsed.value;
        } catch (error) {
            console.error('[LocalStorage] Error loading cache:', error.message);
            return null;
        }
    }

    /**
     * Delete old conversations (auto-cleanup)
     */
    cleanupOldConversations(daysOld = 7) {
        try {
            const conversationsDir = path.join(this.dataDir, 'conversations');
            const timeThreshold = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
            
            let deletedCount = 0;
            const files = fs.readdirSync(conversationsDir);
            
            for (const file of files) {
                const filePath = path.join(conversationsDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtimeMs < timeThreshold) {
                    fs.unlinkSync(filePath);
                    const userId = file.replace('.json', '');
                    this.memory.delete(`conversation_${userId}`);
                    deletedCount++;
                }
            }
            
            console.log(`[LocalStorage] Cleaned up ${deletedCount} old conversations`);
            return deletedCount;
        } catch (error) {
            console.error('[LocalStorage] Error during cleanup:', error.message);
            return 0;
        }
    }

    /**
     * Create backup of all data
     */
    backup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(this.dataDir, 'backups');
            const backupFolder = path.join(backupDir, `backup_${timestamp}`);
            
            fs.mkdirSync(backupFolder, { recursive: true });
            
            // Backup all files
            const conversationsDir = path.join(this.dataDir, 'conversations');
            const analyticsDir = path.join(this.dataDir, 'analytics');
            
            if (fs.existsSync(conversationsDir)) {
                const destConv = path.join(backupFolder, 'conversations');
                fs.mkdirSync(destConv, { recursive: true });
                this.copyDir(conversationsDir, destConv);
            }
            
            if (fs.existsSync(analyticsDir)) {
                const destAnal = path.join(backupFolder, 'analytics');
                fs.mkdirSync(destAnal, { recursive: true });
                this.copyDir(analyticsDir, destAnal);
            }
            
            // Copy learning.json
            const learningFile = path.join(this.dataDir, 'learning.json');
            if (fs.existsSync(learningFile)) {
                fs.copyFileSync(learningFile, path.join(backupFolder, 'learning.json'));
            }
            
            console.log(`[LocalStorage] Backup created: ${backupFolder}`);
            this.stats.lastBackup = Date.now();
            return true;
        } catch (error) {
            console.error('[LocalStorage] Error during backup:', error.message);
            return false;
        }
    }

    /**
     * Helper to copy directory
     */
    copyDir(src, dest) {
        const files = fs.readdirSync(src);
        for (const file of files) {
            const srcFile = path.join(src, file);
            const destFile = path.join(dest, file);
            const stat = fs.statSync(srcFile);
            
            if (stat.isDirectory()) {
                fs.mkdirSync(destFile, { recursive: true });
                this.copyDir(srcFile, destFile);
            } else {
                fs.copyFileSync(srcFile, destFile);
            }
        }
    }

    /**
     * Get total data size in KB
     */
    getDataSize() {
        try {
            let size = 0;
            const walkDir = (dir) => {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const fullPath = path.join(dir, file);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        walkDir(fullPath);
                    } else {
                        size += stat.size;
                    }
                }
            };
            walkDir(this.dataDir);
            return Math.round(size / 1024);  // Return in KB
        } catch (error) {
            return 0;
        }
    }

    /**
     * Start auto-backup interval
     */
    startAutoBackup() {
        const interval = process.env.BACKUP_FREQUENCY || 3600000;  // Default 1 hour
        setInterval(() => {
            this.backup();
        }, interval);
    }

    /**
     * Start auto-cleanup interval
     */
    startAutoCleanup() {
        const interval = process.env.CLEANUP_INTERVAL || 86400000;  // Default 24 hours
        const daysOld = process.env.CONVERSATION_TIMEOUT_DAYS || 7;
        
        setInterval(() => {
            this.cleanupOldConversations(daysOld);
        }, interval);
    }

    /**
     * Get storage statistics
     */
    getStats() {
        return {
            ...this.stats,
            dataSize: this.getDataSize(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Clear all data (careful!)
     */
    clearAll() {
        try {
            const conversationsDir = path.join(this.dataDir, 'conversations');
            if (fs.existsSync(conversationsDir)) {
                fs.rmSync(conversationsDir, { recursive: true, force: true });
                fs.mkdirSync(conversationsDir, { recursive: true });
            }
            
            this.memory.clear();
            console.log('[LocalStorage] All data cleared');
            return true;
        } catch (error) {
            console.error('[LocalStorage] Error clearing data:', error.message);
            return false;
        }
    }
}

module.exports = LocalStorage;
