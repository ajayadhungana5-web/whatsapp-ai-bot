/**
 * Retry Manager with Exponential Backoff
 * Handles automatic retry logic with intelligent backoff
 */
class RetryManager {
    constructor() {
        this.maxRetries = 5;
        this.initialDelay = 1000;  // 1 second
        this.maxDelay = 32000;     // 32 seconds
        this.backoffMultiplier = 2;
    }

    /**
     * Execute function with retry logic
     */
    async executeWithRetry(asyncFn, context = '', metadata = {}) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`[Retry] Attempt ${attempt + 1}/${this.maxRetries + 1} for ${context}`);
                const result = await asyncFn();
                
                if (attempt > 0) {
                    console.log(`[Retry] Success after ${attempt} retries for ${context}`);
                }
                
                return { success: true, result, attempts: attempt + 1 };
            } catch (error) {
                lastError = error;
                
                if (attempt < this.maxRetries) {
                    const delay = this.calculateDelay(attempt);
                    console.error(`[Retry] Attempt ${attempt + 1} failed for ${context}:`, error.message);
                    console.log(`[Retry] Waiting ${delay}ms before retry...`);
                    await this.sleep(delay);
                } else {
                    console.error(`[Retry] All ${this.maxRetries + 1} attempts failed for ${context}`);
                }
            }
        }
        
        return {
            success: false,
            error: lastError.message,
            attempts: this.maxRetries + 1
        };
    }

    /**
     * Calculate exponential backoff delay
     */
    calculateDelay(attemptNumber) {
        const delay = this.initialDelay * Math.pow(this.backoffMultiplier, attemptNumber);
        // Add random jitter to prevent thundering herd
        const jitter = Math.random() * (delay * 0.1);
        return Math.min(delay + jitter, this.maxDelay);
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = RetryManager;
