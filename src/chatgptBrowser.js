const fs = require('fs');
const puppeteer = require('puppeteer');
const path = require('path');

class ChatGPTBrowser {
    constructor() {
        this.browser = null;
        this.page = null;
        this.userDataDir = path.join(process.cwd(), '.puppeteer_data');

        // Ensure data dir exists
        if (!fs.existsSync(this.userDataDir)) {
            fs.mkdirSync(this.userDataDir);
        }
    }

    async init() {
        if (this.browser) return;

        console.log('[ChatGPTBrowser] Launching browser...');
        this.browser = await puppeteer.launch({
            headless: false, // Must be visible to avoid detection and allow manual login
            userDataDir: this.userDataDir,
            args: ['--no-sandbox']
        });

        this.page = await this.browser.newPage();

        // Set a human-like user agent
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log('[ChatGPTBrowser] Navigating to ChatGPT...');
        await this.page.goto('https://chatgpt.com', { waitUntil: 'networkidle2' });

        // Check if logged in (simplistic check)
        const loggedIn = await this.page.evaluate(() => {
            return !!document.querySelector('#prompt-textarea');
        });

        if (!loggedIn) {
            console.log('⚠️ [ChatGPTBrowser] NOT LOGGED IN. Please log in manually in the opened browser window.');
            console.log('waiting 30 seconds for manual login...');
            await new Promise(r => setTimeout(r, 30000));
        } else {
            console.log('✅ [ChatGPTBrowser] Already logged in.');
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    async sendMessage(message) {
        if (!this.browser) await this.init();

        // Ensure we are on the page
        if (this.page.url() !== 'https://chatgpt.com/') {
            await this.page.goto('https://chatgpt.com', { waitUntil: 'networkidle2' });
        }

        try {
            // Wait for input box
            await this.page.waitForSelector('#prompt-textarea', { timeout: 10000 });

            // Type message
            await this.page.type('#prompt-textarea', message);

            // Send (Enter key)
            await this.page.keyboard.press('Enter');

            console.log('[ChatGPTBrowser] Message sent. Waiting for reply...');

            // Wait for the "Stop generating" button to appear and then DISAPPEAR, indicating completion.
            // OR checks for the response stream to finish. 
            // A simple heuristic: wait for the send button to become enabled again or "Stop" to vanish.

            // Wait a static bit for generation to start
            await new Promise(r => setTimeout(r, 2000));

            // Wait for generation to finish (Stop button disappears)
            try {
                // This selector looks for the "Stop generating" button. 
                // Adapt based on class names which change often. 
                // Currently, a safer bet is to wait for the send button to reappear/be active.
                // For now, we use a simple timeout + scraping the last message.

                await new Promise(r => setTimeout(r, 8000)); // Wait 8s for short answer
            } catch (e) { }

            // Scrape the last message
            const response = await this.page.evaluate(() => {
                const bubbles = document.querySelectorAll('.markdown');
                if (bubbles.length > 0) {
                    return bubbles[bubbles.length - 1].innerText;
                }
                return "";
            });

            return response || "I clicked send but couldn't read the answer. (Browser Error)";

        } catch (e) {
            console.error('[ChatGPTBrowser] Error:', e.message);
            return "Failed to automate browser: " + e.message;
        }
    }
}

module.exports = ChatGPTBrowser;
