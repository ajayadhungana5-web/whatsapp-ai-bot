/**
 * Rate Limiter with Abuse Detection
 * Prevents spam and abuse with per-user throttling
 */
class RateLimiter {
    constructor() {
        this.userActivity = new Map();  // userId -> { timestamps: [], blocked: bool, warnings: int }
        this.maxMessagesPerMinute = parseInt(process.env.RATE_LIMIT_MESSAGES_PER_MINUTE || 20);
        this.warningThreshold = parseInt(process.env.RATE_LIMIT_WARNING_THRESHOLD || 15);
        this.blockDurationMs = 5 * 60 * 1000;  // 5 minutes
    }

    /**
     * Check if user is allowed to send message
     */
    isAllowed(userId) {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        // Get or create user entry
        if (!this.userActivity.has(userId)) {
            this.userActivity.set(userId, {
                timestamps: [],
                blocked: false,
                blockedUntil: null,
                warnings: 0
            });
        }

        const userEntry = this.userActivity.get(userId);

        // Check if user is temporarily blocked
        if (userEntry.blocked && userEntry.blockedUntil > now) {
            console.log(`[RateLimit] User ${userId} is blocked until ${new Date(userEntry.blockedUntil).toISOString()}`);
            return { allowed: false, reason: 'temporarily_blocked', remainingMs: userEntry.blockedUntil - now };
        }

        // Unblock if timeout expired
        if (userEntry.blocked && userEntry.blockedUntil <= now) {
            userEntry.blocked = false;
            userEntry.blockedUntil = null;
            userEntry.warnings = 0;
            console.log(`[RateLimit] User ${userId} unblocked`);
        }

        // Remove timestamps older than 1 minute
        userEntry.timestamps = userEntry.timestamps.filter(ts => ts > oneMinuteAgo);

        // Check limit
        if (userEntry.timestamps.length >= this.maxMessagesPerMinute) {
            userEntry.warnings++;
            console.warn(`[RateLimit] User ${userId} exceeded limit (${userEntry.timestamps.length}/${this.maxMessagesPerMinute}). Warnings: ${userEntry.warnings}`);

            // Block after repeated violations
            if (userEntry.warnings > 3) {
                userEntry.blocked = true;
                userEntry.blockedUntil = now + this.blockDurationMs;
                console.warn(`[RateLimit] User ${userId} is now BLOCKED for 5 minutes`);
                return { allowed: false, reason: 'rate_limit_exceeded', blockedMs: this.blockDurationMs };
            }

            return { allowed: true, warning: true, nearLimit: true };
        }

        // Record this message
        userEntry.timestamps.push(now);

        // Warn if approaching limit
        if (userEntry.timestamps.length >= this.warningThreshold) {
            console.log(`[RateLimit] User ${userId} approaching limit (${userEntry.timestamps.length}/${this.maxMessagesPerMinute})`);
            return { allowed: true, warning: true, nearLimit: true };
        }

        return { allowed: true };
    }

    /**
     * Get user activity stats
     */
    getUserStats(userId) {
        const userEntry = this.userActivity.get(userId) || {
            timestamps: [],
            blocked: false,
            warnings: 0
        };

        return {
            messagesThisMinute: userEntry.timestamps.length,
            limit: this.maxMessagesPerMinute,
            warnings: userEntry.warnings,
            isBlocked: userEntry.blocked,
            blockedUntil: userEntry.blockedUntil
        };
    }

    /**
     * Clean up old entries (users not seen in 1 hour)
     */
    cleanup() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        let removed = 0;

        for (const [userId, entry] of this.userActivity.entries()) {
            if (entry.timestamps.length > 0) {
                const lastActivity = entry.timestamps[entry.timestamps.length - 1];
                if (lastActivity < oneHourAgo) {
                    this.userActivity.delete(userId);
                    removed++;
                }
            }
        }

        if (removed > 0) {
            console.log(`[RateLimit] Cleaned up ${removed} inactive user entries`);
        }
    }
}

/**
 * Input Validator
 * Validates and sanitizes incoming messages
 */
class InputValidator {
    constructor() {
        this.maxMessageLength = 10000;
        this.minMessageLength = 1;
    }

    /**
     * Validate message
     */
    validate(message, messageType = 'text') {
        // Check type
        if (typeof message !== 'string') {
            return {
                valid: false,
                error: 'Message must be a string',
                code: 'INVALID_TYPE'
            };
        }

        // Check length
        if (message.length < this.minMessageLength) {
            return {
                valid: false,
                error: 'Message is too short',
                code: 'TOO_SHORT'
            };
        }

        if (message.length > this.maxMessageLength) {
            return {
                valid: false,
                error: `Message exceeds max length of ${this.maxMessageLength} characters`,
                code: 'TOO_LONG'
            };
        }

        // Check for valid Unicode
        try {
            Buffer.from(message, 'utf8').toString('utf8');
        } catch (error) {
            return {
                valid: false,
                error: 'Invalid character encoding',
                code: 'INVALID_ENCODING'
            };
        }

        return { valid: true };
    }

    /**
     * Sanitize message
     */
    sanitize(message) {
        if (typeof message !== 'string') return '';

        // Remove extra whitespace
        let sanitized = message.trim();

        // Remove null characters
        sanitized = sanitized.replace(/\0/g, '');

        // Normalize Unicode
        sanitized = sanitized.normalize('NFC');

        // Remove control characters (except newlines, tabs)
        sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

        return sanitized;
    }

    /**
     * Detect message type
     */
    detectType(message) {
        if (message.includes('http://') || message.includes('https://')) {
            return 'link';
        }
        if (/^\d+$/.test(message)) {
            return 'number';
        }
        if (message.includes('@')) {
            return 'email';
        }
        if (message.includes('+') && /^\+\d+$/.test(message.split(' ')[0])) {
            return 'phone';
        }
        return 'text';
    }

    /**
     * Check for profanity/spam
     */
    hasProfanity(message) {
        const badWords = [
            'spam', 'hate', 'violence', 'suicide', 'drugs'
        ];

        const lowerMessage = message.toLowerCase();
        return badWords.some(word => lowerMessage.includes(word));
    }
}

module.exports = { RateLimiter, InputValidator };
