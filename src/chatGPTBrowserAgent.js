const puppeteer = require('puppeteer');
const GodMode = require('./godMode');

class ChatGPTBrowserAgent {
    constructor() {
        this.browser = null;
        this.page = null;
        this.godMode = new GodMode();
        this.isInitialized = false;
        this.conversationStarted = false;
    }

    /**
     * Initialize browser and navigate to ChatGPT
     */
    async initialize() {
        try {
            console.log('[ChatGPT Browser] Launching browser with dedicated God Mode profile...');

            // Use a dedicated profile for God Mode to avoid conflicts with running Chrome
            const path = require('path');
            const godModeProfileDir = path.join(__dirname, '..', '.god_mode_chrome_profile');

            this.browser = await puppeteer.launch({
                headless: false, // Visible browser
                executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                userDataDir: godModeProfileDir, // Dedicated God Mode profile
                args: [
                    '--start-maximized',
                    '--no-sandbox',

                    '--disable-blink-features=AutomationControlled',
                    '--disable-web-security',
                    '--no-first-run',
                    '--no-default-browser-check'
                ],
                defaultViewport: null
            });

            this.page = await this.browser.newPage();

            // Navigate to ChatGPT
            console.log('[ChatGPT Browser] Navigating to ChatGPT...');
            await this.page.goto('https://chatgpt.com/', { waitUntil: 'networkidle2', timeout: 60000 });

            // Wait a bit for the page to fully load
            await new Promise(resolve => setTimeout(resolve, 3000));

            this.isInitialized = true;
            console.log('[ChatGPT Browser] ✅ Browser initialized and ready');

            return '🤖 God Mode Activated!\n\nChatGPT browser opened. I can now execute any command through ChatGPT.\n\nTry: "open YouTube and play kings song" or any system command!';

        } catch (error) {
            console.error('[ChatGPT Browser] Initialization failed:', error.message);
            throw new Error(`Failed to initialize ChatGPT browser: ${error.message}`);
        }
    }

    /**
     * Process a command via ChatGPT
     */
    async processCommand(userMessage) {
        if (!this.isInitialized) {
            return '⚠️ God Mode not initialized. Please restart God Mode.';
        }

        try {
            // Create the prompt for ChatGPT
            const systemPrompt = `You are a Windows System Control AI. The user will give you commands to control their laptop.

Available actions you can perform:
1. **shell_exec**: Run Windows commands (e.g., "start chrome", "mkdir folder", "dir")
2. **browser_open**: Open a URL and optionally click elements
3. **file_write**: Create/write files
4. **file_read**: Read files
5. **response**: Just reply to the user

User Command: "${userMessage}"

Respond in this EXACT JSON format:
{
  "action": "shell_exec" | "browser_open" | "file_write" | "file_read" | "response",
  "params": {
    "command": "..." (for shell_exec),
    "url": "..." (for browser_open),
    "clickSelector": "..." (optional, for browser_open),
    "path": "..." (for file operations),
    "content": "..." (for file_write),
    "text": "..." (for response)
  },
  "explanation": "Brief explanation of what you're doing"
}

Examples:
- "play song on YouTube" → {"action":"browser_open","params":{"url":"https://youtube.com/results?search_query=song","clickSelector":"ytd-video-renderer a#video-title"},"explanation":"Opening YouTube and playing first result"}
- "open chrome" → {"action":"shell_exec","params":{"command":"start chrome"},"explanation":"Launching Chrome"}
- "create folder test" → {"action":"shell_exec","params":{"command":"mkdir test"},"explanation":"Creating folder named test"}

Respond ONLY with the JSON, nothing else.`;

            console.log('[ChatGPT Browser] Sending command to ChatGPT...');

            // Send to ChatGPT
            const response = await this.sendToChatGPT(systemPrompt);

            console.log('[ChatGPT Browser] ChatGPT response:', response);

            // Parse the response
            let action;
            try {
                // Extract JSON from response (ChatGPT might wrap it in markdown)
                let jsonStr = response;

                // Remove markdown code blocks if present
                if (jsonStr.includes('```json')) {
                    jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
                } else if (jsonStr.includes('```')) {
                    jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
                }

                action = JSON.parse(jsonStr);
            } catch (parseError) {
                console.error('[ChatGPT Browser] Failed to parse JSON:', parseError.message);
                // Fallback: Try to understand simple commands directly
                return await this.fallbackParser(userMessage);
            }

            // Execute the action
            return await this.executeAction(action);

        } catch (error) {
            console.error('[ChatGPT Browser] Error processing command:', error.message);
            return `❌ Error: ${error.message}\n\nTrying fallback method...`;
        }
    }

    /**
     * Send message to ChatGPT and get response
     */
    async sendToChatGPT(message) {
        try {
            // Try multiple possible selectors for ChatGPT input
            const possibleSelectors = [
                '#prompt-textarea',
                'textarea[placeholder*="Message"]',
                'textarea[placeholder*="Send"]',
                'textarea',
                '[contenteditable="true"]'
            ];

            let inputElement = null;
            let usedSelector = null;

            for (const selector of possibleSelectors) {
                try {
                    await this.page.waitForSelector(selector, { timeout: 3000 });
                    inputElement = await this.page.$(selector);
                    if (inputElement) {
                        usedSelector = selector;
                        console.log(`[ChatGPT Browser] Found input using selector: ${selector}`);
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!inputElement) {
                throw new Error('Could not find ChatGPT input field');
            }

            // Focus and type the message
            await inputElement.click();
            await new Promise(resolve => setTimeout(resolve, 500));

            // Clear existing content
            await this.page.evaluate(() => {
                const textareas = document.querySelectorAll('textarea');
                textareas.forEach(t => t.value = '');
            });

            // Type the new message
            await this.page.keyboard.type(message, { delay: 20 });
            await new Promise(resolve => setTimeout(resolve, 500));

            // Press Enter to send
            await this.page.keyboard.press('Enter');

            // Wait for response
            await new Promise(resolve => setTimeout(resolve, 3000)); // Initial wait

            // Wait for ChatGPT to finish typing (look for the stop generating button to disappear)
            let waitTime = 0;
            const maxWait = 30000; // 30 seconds max

            while (waitTime < maxWait) {
                const isTyping = await this.page.$('button[aria-label*="Stop"]');
                if (!isTyping) break;

                await new Promise(resolve => setTimeout(resolve, 500));
                waitTime += 500;
            }

            // Extract the last response - try multiple methods
            let responseText = '';

            // Method 1: Look for assistant messages
            try {
                const responseElements = await this.page.$$('[data-message-author-role="assistant"]');
                if (responseElements.length > 0) {
                    const lastResponse = responseElements[responseElements.length - 1];
                    responseText = await this.page.evaluate(el => el.innerText, lastResponse);
                }
            } catch (e) {
                console.log('[ChatGPT Browser] Method 1 failed, trying method 2...');
            }

            // Method 2: Look for markdown content
            if (!responseText) {
                try {
                    const markdown = await this.page.$$('.markdown');
                    if (markdown.length > 0) {
                        const lastMd = markdown[markdown.length - 1];
                        responseText = await this.page.evaluate(el => el.innerText, lastMd);
                    }
                } catch (e) {
                    console.log('[ChatGPT Browser] Method 2 failed');
                }
            }

            if (!responseText) {
                throw new Error('No response from ChatGPT');
            }

            return responseText;

        } catch (error) {
            console.error('[ChatGPT Browser] Error communicating with ChatGPT:', error.message);
            throw error;
        }
    }

    /**
     * Execute the parsed action
     */
    async executeAction(action) {
        const { action: actionType, params, explanation } = action;

        let result = '';

        switch (actionType) {
            case 'shell_exec':
                console.log('[ChatGPT Browser] Executing shell command:', params.command);
                result = await this.godMode.executeCommand(params.command);
                return `✅ ${explanation}\n\n${result}`;

            case 'browser_open':
                console.log('[ChatGPT Browser] Opening browser:', params.url);
                if (params.clickSelector) {
                    result = await this.godMode.browserAutomate(params.url, [
                        { type: 'wait', ms: 3000 },
                        { type: 'click', selector: params.clickSelector }
                    ]);
                } else {
                    result = await this.godMode.browserAutomate(params.url, []);
                }
                return `✅ ${explanation}\n\n${result}`;

            case 'file_write':
                console.log('[ChatGPT Browser] Writing file:', params.path);
                result = await this.godMode.writeFile(params.path, params.content);
                return `✅ ${explanation}\n\n${result}`;

            case 'file_read':
                console.log('[ChatGPT Browser] Reading file:', params.path);
                result = await this.godMode.readFile(params.path);
                return `✅ ${explanation}\n\nContent:\n${result}`;

            case 'response':
                return `💬 ${params.text || explanation}`;

            default:
                return `⚠️ Unknown action type: ${actionType}`;
        }
    }

    /**
     * Fallback parser when ChatGPT doesn't return proper JSON
     */
    async fallbackParser(userMessage) {
        const msg = userMessage.toLowerCase().trim();

        // YouTube patterns
        if (msg.includes('play') && (msg.includes('youtube') || msg.includes('yt'))) {
            const query = msg.replace(/play/gi, '').replace(/youtube/gi, '').replace(/yt/gi, '').replace(/on/gi, '').trim();
            const result = await this.godMode.browserAutomate(
                `https://youtube.com/results?search_query=${encodeURIComponent(query)}`,
                [
                    { type: 'wait', ms: 3000 },
                    { type: 'click', selector: 'ytd-video-renderer a#video-title' }
                ]
            );
            return `🎵 Playing "${query}" on YouTube\n\n${result}`;
        }

        // Open apps
        if (msg.includes('open') || msg.includes('start')) {
            if (msg.includes('chrome')) {
                const result = await this.godMode.executeCommand('start chrome');
                return `✅ Opening Chrome\n\n${result}`;
            }
            if (msg.includes('youtube') || msg.includes('yt')) {
                const result = await this.godMode.browserAutomate('https://youtube.com', []);
                return `✅ Opening YouTube\n\n${result}`;
            }
        }

        return '⚠️ Could not understand command. Please try rephrasing or use simpler commands like:\n- "play [song] on YouTube"\n- "open chrome"\n- "list files"';
    }

    /**
     * Shutdown the browser
     */
    async shutdown() {
        try {
            if (this.browser) {
                console.log('[ChatGPT Browser] Closing browser...');
                await this.browser.close();
                this.browser = null;
                this.page = null;
                this.isInitialized = false;
                console.log('[ChatGPT Browser] ✅ Browser closed');
                return '⚡ God Mode Deactivated\n\nChatGPT browser closed. Back to normal mode.';
            }
            return 'God Mode was not active.';
        } catch (error) {
            console.error('[ChatGPT Browser] Error closing browser:', error.message);
            return `⚠️ Error closing browser: ${error.message}`;
        }
    }
}

module.exports = ChatGPTBrowserAgent;
