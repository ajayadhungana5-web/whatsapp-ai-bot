const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');

/**
 * ChatGPT Provider - Web Automation
 * Opens ChatGPT web app, sends query, and extracts response
 */
class ChatGPTProvider {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
        // Store session in user data directory so browser stays logged in
        this.userDataDir = path.join(os.homedir(), '.whatsapp-bot-chatgpt');
    }

    // Helper for delays (compatible with older Puppeteer)
    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async initialize() {
        if (this.browser) return; // Already initialized

        console.log('[ChatGPT] Launching browser...');
        this.browser = await puppeteer.launch({
            headless: false, // Keep visible so user can see and login if needed
            userDataDir: this.userDataDir, // Persist session
            args: [
                '--no-sandbox',

                '--disable-blink-features=AutomationControlled'
            ]
        });

        this.page = await this.browser.newPage();

        // Set realistic user agent
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Navigate to ChatGPT
        console.log('[ChatGPT] Opening ChatGPT...');
        await this.page.goto('https://chatgpt.com/', { waitUntil: 'networkidle2', timeout: 60000 });

        // Check if logged in
        await this.checkLoginStatus();
    }

    async checkLoginStatus() {
        try {
            // Wait a bit for page to load
            await this.wait(3000);

            // Check if we see the prompt textarea (logged in) or login button (not logged in)
            // Updated selectors for ChatGPT's new UI (Jan 2026)
            const textareaSelectors = [
                'textarea#prompt-textarea',
                'textarea[placeholder*="Message"]',
                'textarea[placeholder*="Send"]',
                'div[contenteditable="true"][role="textbox"]',
                'textarea[data-id="root"]',
                'textarea',
                'div[contenteditable="true"]'
            ];

            let promptExists = false;
            for (const selector of textareaSelectors) {
                const element = await this.page.$(selector);
                if (element) {
                    console.log(`[ChatGPT] Found textarea with selector: ${selector}`);
                    promptExists = true;
                    break;
                }
            }

            if (promptExists) {
                console.log('[ChatGPT] Already logged in!');
                this.isLoggedIn = true;
            } else {
                console.log('[ChatGPT] NOT logged in. Please login manually in the browser window.');
                console.log('[ChatGPT] Waiting 60 seconds for manual login...');

                // Wait for user to login - try all textarea selectors
                let loginSuccess = false;
                for (const selector of textareaSelectors) {
                    try {
                        await this.page.waitForSelector(selector, { timeout: 60000 });
                        console.log(`[ChatGPT] Login detected! Found: ${selector}`);
                        loginSuccess = true;
                        break;
                    } catch (e) {
                        // Try next selector
                        continue;
                    }
                }

                if (!loginSuccess) {
                    throw new Error('Login timeout - no textarea found after 60s');
                }

                this.isLoggedIn = true;
            }
        } catch (error) {
            console.error('[ChatGPT] Login check failed:', error.message);
            throw new Error('ChatGPT login failed. Please ensure you can access ChatGPT manually.');
        }
    }

    async query(question) {
        try {
            // Initialize if not already done
            if (!this.browser) {
                await this.initialize();
            }

            console.log(`[ChatGPT] Query: "${question}"`);

            // Updated selectors for ChatGPT's current UI (Jan 2026)
            const textareaSelectors = [
                '#prompt-textarea',
                'textarea#prompt-textarea',
                'textarea[placeholder*="Message"]',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                'textarea[data-id="root"]',
                'textarea'
            ];

            let textarea = null;
            for (const selector of textareaSelectors) {
                try {
                    textarea = await this.page.$(selector);
                    if (textarea) {
                        console.log(`[ChatGPT] Found textarea: ${selector}`);
                        break;
                    }
                } catch (e) { }
            }

            if (!textarea) {
                console.error('[ChatGPT] Prompt textarea not found!');
                return "ChatGPT UI has changed. Please ensure ChatGPT is loaded and you're logged in.";
            }

            // Focus and clear (more robustly)
            await textarea.focus();
            
            // Try different clearing strategies
            try {
                await this.page.evaluate((el) => { 
                    if (el.innerText !== undefined) {
                        el.innerText = '';
                    } else if (el.innerHTML !== undefined) {
                        el.innerHTML = '';
                    } else if (el.value !== undefined) {
                        el.value = '';
                    }
                }, textarea);
            } catch (e) {
                console.log('[ChatGPT] Using keyboard clear method');
            }
            
            await this.page.keyboard.down('Control');
            await this.page.keyboard.press('A');
            await this.page.keyboard.up('Control');
            await this.page.keyboard.press('Backspace');
            await this.wait(300);

            // Type the question
            console.log('[ChatGPT] Typing...');
            await textarea.type(question, { delay: 10 }); // Faster typing
            await this.wait(500);

            // Click send button/Press Enter
            console.log('[ChatGPT] Sending...');
            await this.page.keyboard.press('Enter');

            console.log('[ChatGPT] Waiting for response...');

            // Wait for "Stop generating" button to appear OR response to start streaming
            try {
                await this.page.waitForSelector('[data-testid="send-button"]', { timeout: 5000 }); // Wait for send button to reset or disappear
            } catch (e) { }

            await this.wait(2000); // Initial buffer

            // Wait for response to be complete
            console.log('[ChatGPT] Monitoring generation...');
            let waitCount = 0;
            const maxWaitSeconds = 60;
            let lastTextLength = 0;
            let stableCount = 0;

            while (waitCount < maxWaitSeconds) {
                // Check if result is stable (length hasn't changed for 2 seconds)
                const currentText = await this.page.evaluate(() => {
                    // Try multiple selectors for assistant messages
                    const messageSelectors = [
                        '[data-message-author-role="assistant"]',
                        '[role="article"]',
                        'article',
                        '[class*="message"]'
                    ];
                    
                    for (const sel of messageSelectors) {
                        const messages = document.querySelectorAll(sel);
                        if (messages.length > 0) {
                            return messages[messages.length - 1].innerText || messages[messages.length - 1].textContent || '';
                        }
                    }
                    return '';
                });

                if (currentText.length > 0 && currentText.length === lastTextLength) {
                    stableCount++;
                } else {
                    stableCount = 0;
                }

                lastTextLength = currentText.length;

                // If stable for 2 seconds (4 loops * 500ms), we assume it's done
                if (stableCount >= 4) {
                    console.log('[ChatGPT] Response appears stable.');
                    break;
                }

                await this.wait(500);
                waitCount += 0.5;
            }

            // Extract response with updated selectors
            const response = await this.page.evaluate(() => {
                // Try multiple selectors
                const messageSelectors = [
                    '[data-message-author-role="assistant"]',
                    '[role="article"]',
                    'article'
                ];
                
                for (const sel of messageSelectors) {
                    const messages = Array.from(document.querySelectorAll(sel));
                    if (messages.length > 0) {
                        const lastMessage = messages[messages.length - 1];
                        return (lastMessage.innerText || lastMessage.textContent || '').trim();
                    }
                }
                return null;
            });

            if (response) {
                console.log(`[ChatGPT] Got response (${response.length} chars)`);
                return response;
            } else {
                console.log('[ChatGPT] No response found');
                return "Couldn't get ChatGPT response. The interface may have changed.";
            }

        } catch (error) {
            console.error('[ChatGPT] Error:', error.message);
            return `ChatGPT error: ${error.message}`;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isLoggedIn = false;
        }
    }
}

module.exports = ChatGPTProvider;
