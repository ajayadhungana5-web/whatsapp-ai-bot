const GodMode = require('./godMode');

/**
 * GodModeAgent - Pure Pattern-Based Command Execution
 * ZERO external API dependencies - 100% offline execution
 * All commands recognized via regex pattern matching
 * No AI, no API calls, direct system interactions
 */
class GodModeAgent {
    constructor() {
        this.godMode = new GodMode();
        console.log('[GodMode] Initialized - Ready to execute commands');
    }

    parseCommandDirectly(userMessage) {
        const msg = userMessage.toLowerCase().trim();

        // BROWSER NAVIGATION
        if (msg === 'back' || msg === 'go back' || msg === 'previous') {
            return { tool: 'browser_back', args: {}, explanation: 'Going back' };
        }
        if (msg === 'forward' || msg === 'go forward' || msg === 'next') {
            return { tool: 'browser_forward', args: {}, explanation: 'Going forward' };
        }
        if (msg.includes('reload') || msg.includes('refresh')) {
            return { tool: 'browser_reload', args: {}, explanation: 'Reloading page' };
        }
        if (msg.includes('close') && (msg.includes('browser') || msg.includes('chrome') || msg.includes('youtube') || msg.includes('tab'))) {
            return { tool: 'browser_close', args: {}, explanation: 'Closing browser' };
        }

        // YOUTUBE
        if (msg.includes('open') && (msg.includes('youtube') || msg.includes('yt'))) {
            return {
                tool: 'browser_automate',
                args: { url: 'https://youtube.com', actions: [] },
                explanation: 'Opening YouTube'
            };
        }

        // CHROME / BROWSER OPEN
        if (msg.includes('open') && (msg.includes('chrome') || msg.includes('brave') || msg.includes('edge'))) {
            return {
                tool: 'browser_automate',
                args: { url: 'https://www.google.com', actions: [] },
                explanation: 'Opening browser'
            };
        }

        // FILE OPERATIONS - CREATE FOLDER
        if (msg.includes('create') && msg.includes('folder')) {
            const folderName = msg.replace(/create/gi, '').replace(/folder/gi, '').trim() || 'NewFolder';
            return { tool: 'folder_create', args: { path: folderName }, explanation: `Creating folder: ${folderName}` };
        }

        // FILE OPERATIONS - LIST FILES
        if (msg.includes('list') || msg === 'dir' || msg === 'files') {
            return { tool: 'shell_exec', args: { command: 'dir' }, explanation: 'Listing files' };
        }

        // SYSTEM INFO
        if (msg.includes('system') && msg.includes('info')) {
            return { tool: 'system_info', args: {}, explanation: 'Getting system information' };
        }

        // APP OPERATIONS
        if (msg.includes('open') && msg.includes('notepad')) {
            return { tool: 'shell_exec', args: { command: 'start notepad' }, explanation: 'Opening Notepad' };
        }
        if (msg.includes('open') && msg.includes('calc')) {
            return { tool: 'shell_exec', args: { command: 'start calc' }, explanation: 'Opening Calculator' };
        }
        if (msg.includes('open') && msg.includes('explorer')) {
            return { tool: 'shell_exec', args: { command: 'start explorer' }, explanation: 'Opening Explorer' };
        }

        return null;
    }

    async processRequest(userMessage) {
        console.log(`[GodMode] Processing: "${userMessage}"`);
        
        const action = this.parseCommandDirectly(userMessage);

        if (!action) {
            return `⚠️ Command not recognized: "${userMessage}"`;
        }

        try {
            // BROWSER COMMANDS
            if (action.tool === 'browser_back') {
                return await this.godMode.browserBack();
            }
            if (action.tool === 'browser_forward') {
                return await this.godMode.browserForward();
            }
            if (action.tool === 'browser_reload') {
                return await this.godMode.browserReload();
            }
            if (action.tool === 'browser_close') {
                return await this.godMode.browserClose();
            }

            // BROWSER AUTOMATION
            if (action.tool === 'browser_automate') {
                await this.godMode.browserAutomate(action.args.url, action.args.actions || []);
                return `✅ ${action.explanation}`;
            }

            // SHELL COMMANDS
            if (action.tool === 'shell_exec') {
                const output = await this.godMode.executeCommand(action.args.command);
                return `✅ ${action.explanation}\n\nOutput:\n${output}`;
            }

            // FILE OPERATIONS
            if (action.tool === 'folder_create') {
                return await this.godMode.createFolder(action.args.path);
            }

            // SYSTEM OPERATIONS
            if (action.tool === 'system_info') {
                return await this.godMode.getSystemInfo();
            }

            return `✅ ${action.explanation}`;
        } catch (error) {
            return `❌ Error: ${error.message}`;
        }
    }
}

module.exports = GodModeAgent;
