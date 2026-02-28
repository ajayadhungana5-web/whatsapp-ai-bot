const fs = require('fs');
const path = require('path');

/**
 * Enhanced Logging System
 * Persistent logging with file rotation and analytics
 */
class Logger {
    constructor(logsDir = './data/logs') {
        this.logsDir = logsDir;
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.levels = { error: 0, warn: 1, info: 2, debug: 3 };
        
        // Ensure logs directory exists
        this.ensureLogsDir();
        
        // Initialize daily log file
        this.currentDate = this.getDateString();
        this.currentLogFile = this.getLogFilePath(this.currentDate);
        
        console.log(`[Logger] Initialized. Logs dir: ${logsDir}`);
    }

    ensureLogsDir() {
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    getDateString() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    getLogFilePath(date = null) {
        const dateStr = date || this.getDateString();
        return path.join(this.logsDir, `bot_${dateStr}.log`);
    }

    getTimestamp() {
        return new Date().toISOString();
    }

    /**
     * Check if daily log file needs rotation
     */
    checkLogRotation() {
        const today = this.getDateString();
        if (today !== this.currentDate) {
            this.currentDate = today;
            this.currentLogFile = this.getLogFilePath(today);
            this.info('Log rotated to new day');
        }
    }

    /**
     * Write log entry to file
     */
    writeLog(level, message, metadata = {}) {
        this.checkLogRotation();

        const timestamp = this.getTimestamp();

        // Structured JSON log entry (one JSON object per line)
        const jsonEntry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            metadata
        };

        try {
            fs.appendFileSync(this.currentLogFile, JSON.stringify(jsonEntry) + '\n');
        } catch (error) {
            console.error('Failed to write log:', error.message);
        }

        // Also console log based on level (structured)
        if (this.levels[level] <= this.levels[this.logLevel]) {
            try {
                console.log(JSON.stringify(jsonEntry));
            } catch (e) {
                console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
            }
        }

        try {
            fs.appendFileSync(this.currentLogFile, logEntry);
        } catch (error) {
            console.error('Failed to write log:', error.message);
        }

        // Also console log based on level
        if (this.levels[level] <= this.levels[this.logLevel]) {
            const colorMap = {
                error: '\x1b[31m',    // Red
                warn: '\x1b[33m',     // Yellow
                info: '\x1b[36m',     // Cyan
                debug: '\x1b[35m'     // Magenta
            };
            const reset = '\x1b[0m';
            const color = colorMap[level] || '';
            console.log(`${color}${logEntry}${reset}`);
        }
    }

    error(message, metadata = {}) {
        this.writeLog('error', message, metadata);
    }

    warn(message, metadata = {}) {
        this.writeLog('warn', message, metadata);
    }

    info(message, metadata = {}) {
        this.writeLog('info', message, metadata);
    }

    debug(message, metadata = {}) {
        this.writeLog('debug', message, metadata);
    }

    /**
     * Log API call
     */
    logApiCall(endpoint, method, statusCode, duration, error = null) {
        const metadata = {
            endpoint,
            method,
            statusCode,
            durationMs: duration,
            error
        };

        const level = statusCode >= 400 ? 'error' : 'info';
        this.writeLog(level, `API Call: ${method} ${endpoint}`, metadata);
    }

    /**
     * Log user interaction
     */
    logInteraction(userId, message, intent, response, responseTime) {
        const metadata = {
            userId,
            messageLength: message.length,
            intent,
            responseLength: response?.length || 0,
            responseTimeMs: responseTime
        };

        this.writeLog('info', `User Interaction: ${userId}`, metadata);
    }

    /**
     * Log error with stack trace
     */
    logError(error, context = '') {
        const metadata = {
            context,
            stack: error.stack,
            name: error.name,
            code: error.code
        };

        this.writeLog('error', error.message, metadata);
    }

    /**
     * Get logs for a date range
     */
    getLogs(fromDate = null, toDate = null) {
        try {
            const logs = [];
            const start = fromDate ? new Date(fromDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const end = toDate ? new Date(toDate) : new Date();

            // Iterate through date range
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = this.getDateString.call({ getDateString: () => {
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                } })();
                
                const logFile = this.getLogFilePath(dateStr);
                if (fs.existsSync(logFile)) {
                    const content = fs.readFileSync(logFile, 'utf8');
                    logs.push(...content.split('\n').filter(line => line.trim()));
                }
            }

            return logs;
        } catch (error) {
            this.error('Failed to get logs', { error: error.message });
            return [];
        }
    }

    /**
     * Search logs
     */
    searchLogs(keyword, limit = 100) {
        const allLogs = this.getLogs();
        return allLogs
            .filter(log => log.toLowerCase().includes(keyword.toLowerCase()))
            .slice(-limit);
    }

    /**
     * Get log statistics
     */
    getStats() {
        try {
            const logs = this.getLogs();
            const stats = {
                totalEntries: logs.length,
                errors: logs.filter(l => l.includes('[ERROR]')).length,
                warnings: logs.filter(l => l.includes('[WARN]')).length,
                info: logs.filter(l => l.includes('[INFO]')).length,
                debug: logs.filter(l => l.includes('[DEBUG]')).length
            };

            return stats;
        } catch (error) {
            return {};
        }
    }

    /**
     * Archive old logs
     */
    archiveLogs(olderThanDays = 30) {
        try {
            const archiveDir = path.join(this.logsDir, 'archived');
            if (!fs.existsSync(archiveDir)) {
                fs.mkdirSync(archiveDir, { recursive: true });
            }

            const files = fs.readdirSync(this.logsDir);
            const now = Date.now();
            const threshold = olderThanDays * 24 * 60 * 60 * 1000;
            let archived = 0;

            for (const file of files) {
                if (file.endsWith('.log')) {
                    const filePath = path.join(this.logsDir, file);
                    const stats = fs.statSync(filePath);

                    if (now - stats.mtimeMs > threshold) {
                        const destPath = path.join(archiveDir, file);
                        fs.renameSync(filePath, destPath);
                        archived++;
                    }
                }
            }

            this.info(`Archived ${archived} log files`);
            return archived;
        } catch (error) {
            this.error('Failed to archive logs', { error: error.message });
            return 0;
        }
    }
}

module.exports = Logger;
