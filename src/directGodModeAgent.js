const GodMode = require('./godMode');

/**
 * Direct Execution God Mode Agent
 * No ChatGPT, no APIs - just direct command execution
 */
class DirectGodModeAgent {
    constructor() {
        this.godMode = new GodMode();
        this.isActive = false;
    }

    /**
     * Activate God Mode
     */
    async activate() {
        this.isActive = true;
        console.log('[God Mode] ⚡ Direct Execution Mode Activated');
        return '🤖 God Mode Activated!\n\nI can now control your laptop directly.\n\nTry:\n- "open youtube and play kings song"\n- "create folder test"\n- "open calculator"\n- "list files"';
    }

    /**
     * Deactivate God Mode
     */
    async deactivate() {
        this.isActive = false;
        console.log('[God Mode] ⚡ Direct Execution Mode Deactivated');
        return '⚡ God Mode Deactivated\n\nBack to normal mode.';
    }

    /**
     * Execute a command directly
     */
    async executeCommand(userMessage) {
        if (!this.isActive) {
            return '⚠️ God Mode is not active. Send "god mode start" first.';
        }

        const msg = userMessage.toLowerCase().trim();
        console.log(`[God Mode] Processing: "${userMessage}"`);

        try {
            // ========================================
            // BROWSER NAVIGATION COMMANDS
            // ========================================

            // Back command
            if (msg === 'back' || msg.includes('go back') || msg.includes('previous')) {
                const result = await this.godMode.browserBack();
                return result;
            }

            // Forward command
            if (msg === 'forward' || msg.includes('go forward') || msg.includes('next')) {
                const result = await this.godMode.browserForward();
                return result;
            }

            // Reload page
            if (msg === 'reload' || msg.includes('refresh') || msg.includes('refresh page')) {
                const result = await this.godMode.browserReload();
                return result;
            }

            // Close YouTube / Close current tab
            if (msg.includes('close') && (msg.includes('youtube') || msg.includes('tab') || msg.includes('page'))) {
                const result = await this.godMode.browserCloseTab();
                return `${result}`;
            }

            // Close browser completely
            if (msg === 'close' || msg === 'close browser' || msg.includes('close all')) {
                const result = await this.godMode.browserClose();
                return `${result}`;
            }

            // ========================================
            // YOUTUBE COMMANDS
            // ========================================
            if (msg.includes('play') && (msg.includes('youtube') || msg.includes('yt'))) {
                const query = userMessage
                    .replace(/play/gi, '')
                    .replace(/youtube/gi, '')
                    .replace(/yt/gi, '')
                    .replace(/on/gi, '')
                    .replace(/video/gi, '')
                    .replace(/song/gi, '')
                    .trim();

                const result = await this.godMode.browserAutomate(
                    `https://youtube.com/results?search_query=${encodeURIComponent(query)}`,
                    [
                        { type: 'wait', ms: 3000 },
                        { type: 'click', selector: 'ytd-video-renderer a#video-title' }
                    ]
                );
                return `🎵 Playing "${query}" on YouTube\n\n${result}`;
            }

            // Open YouTube homepage
            if ((msg.includes('open') || msg.includes('go to')) && (msg.includes('youtube') || msg.includes('yt'))) {
                const result = await this.godMode.browserAutomate('https://youtube.com', []);
                return `✅ Opening YouTube\n\n${result}`;
            }

            // ========================================
            // BROWSER COMMANDS WITH ACTIONS
            // ========================================

            // Pattern: "open [browser] and search/play/go to [query]"
            const openBrowserPattern = msg.match(/open\s+(brave|chrome|edge|firefox)?\s+and\s+(search|play|go to|open)\s+(.+)/i);
            if (openBrowserPattern) {
                const browserName = openBrowserPattern[1]?.toLowerCase() || 'chrome';
                const action = openBrowserPattern[2]?.toLowerCase() || 'search';
                const query = openBrowserPattern[3]?.trim() || '';

                if (action.includes('play')) {
                    // YouTube play
                    const result = await this.godMode.youtubePlay(query);
                    return result;
                } else if (action.includes('search')) {
                    // Google search
                    const result = await this.godMode.webSearch(query);
                    return `🔍 Searching for: "${query}"\n\n${result}`;
                } else if (action.includes('go to')) {
                    // Navigate to URL or search
                    const url = query.startsWith('http') ? query : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                    const result = await this.godMode.browserNavigate(url);
                    return result;
                }
            }

            // ========================================
            // OPEN APPLICATIONS
            // ========================================
            const appCommands = [
                { keywords: ['brave', 'brave browser'], command: 'start brave', name: 'Brave', isBrowser: true, type: 'brave' },
                { keywords: ['chrome', 'google chrome'], command: 'start chrome', name: 'Chrome', isBrowser: true, type: 'chrome' },
                { keywords: ['edge', 'microsoft edge'], command: 'start msedge', name: 'Edge', isBrowser: true, type: 'edge' },
                { keywords: ['notepad'], command: 'start notepad', name: 'Notepad' },
                { keywords: ['calculator', 'calc'], command: 'start calc', name: 'Calculator' },
                { keywords: ['vscode', 'vs code', 'code'], command: 'start code', name: 'VS Code' },
                { keywords: ['explorer', 'file explorer'], command: 'start explorer', name: 'File Explorer' },
                { keywords: ['cmd', 'command prompt'], command: 'start cmd', name: 'Command Prompt' },
                { keywords: ['powershell'], command: 'start powershell', name: 'PowerShell' },
                { keywords: ['paint'], command: 'start mspaint', name: 'Paint' },
            ];

            for (const app of appCommands) {
                if ((msg.includes('open') || msg.includes('start') || msg.includes('launch')) &&
                    app.keywords.some(kw => msg.includes(kw))) {
                    const result = await this.godMode.executeCommand(app.command);
                    return `✅ Opening ${app.name}\n\n${result}`;
                }
            }

            // ========================================
            // CLOSE APPLICATIONS
            // ========================================
            const closeCommands = [
                { keywords: ['calculator', 'calc'], command: 'taskkill /IM calculator.exe /F', name: 'Calculator' },
                { keywords: ['notepad'], command: 'taskkill /IM notepad.exe /F', name: 'Notepad' },
                { keywords: ['chrome'], command: 'taskkill /IM chrome.exe /F', name: 'Chrome' },
                { keywords: ['paint'], command: 'taskkill /IM mspaint.exe /F', name: 'Paint' },
            ];

            for (const app of closeCommands) {
                if (msg.includes('close') && app.keywords.some(kw => msg.includes(kw))) {
                    const result = await this.godMode.executeCommand(app.command);
                    return `✅ Closing ${app.name}\n\n${result}`;
                }
            }

            // ========================================
            // FILE & FOLDER OPERATIONS
            // ========================================

            // Create folder
            if (msg.includes('create') && msg.includes('folder')) {
                const folderName = userMessage
                    .replace(/create/gi, '')
                    .replace(/folder/gi, '')
                    .replace(/named?/gi, '')
                    .replace(/called/gi, '')
                    .trim() || 'NewFolder';
                const result = await this.godMode.executeCommand(`mkdir "${folderName}"`);
                return `✅ Created folder: ${folderName}\n\n${result}`;
            }

            // Delete folder
            if (msg.includes('delete') && msg.includes('folder')) {
                const folderName = userMessage
                    .replace(/delete/gi, '')
                    .replace(/folder/gi, '')
                    .replace(/the/gi, '')
                    .trim();
                const result = await this.godMode.executeCommand(`rmdir /s /q "${folderName}"`);
                return `✅ Deleted folder: ${folderName}\n\n${result}`;
            }

            // Create file
            if (msg.includes('create') && msg.includes('file')) {
                // Extract filename and content
                const parts = userMessage.split(/with content|containing/i);
                const filename = parts[0]
                    .replace(/create/gi, '')
                    .replace(/file/gi, '')
                    .replace(/named?/gi, '')
                    .replace(/called/gi, '')
                    .trim() || 'newfile.txt';
                const content = parts.length > 1 ? parts[1].trim().replace(/["']/g, '') : '';

                const result = await this.godMode.writeFile(filename, content);
                return `✅ Created file: ${filename}\n\n${result}`;
            }

            // Delete file
            if (msg.includes('delete') && msg.includes('file')) {
                const filename = userMessage
                    .replace(/delete/gi, '')
                    .replace(/file/gi, '')
                    .replace(/the/gi, '')
                    .trim();
                const result = await this.godMode.executeCommand(`del /f "${filename}"`);
                return `✅ Deleted file: ${filename}\n\n${result}`;
            }

            // Read file
            if (msg.includes('read') || msg.includes('show')) {
                const filename = userMessage
                    .replace(/read/gi, '')
                    .replace(/show/gi, '')
                    .replace(/file/gi, '')
                    .replace(/the/gi, '')
                    .trim();
                const result = await this.godMode.readFile(filename);
                return `📄 Content of ${filename}:\n\n${result}`;
            }

            // List files
            if (msg.includes('list') && (msg.includes('file') || msg.includes('folder') || msg.includes('directory'))) {
                const result = await this.godMode.executeCommand('dir');
                return `📂 Files and folders:\n\n${result}`;
            }

            // ========================================
            // SYSTEM COMMANDS
            // ========================================

            // Volume control
            if (msg.includes('volume')) {
                if (msg.includes('up') || msg.includes('increase')) {
                    const result = await this.godMode.executeCommand('nircmd.exe changesysvolume 2000');
                    return `🔊 Volume increased`;
                } else if (msg.includes('down') || msg.includes('decrease')) {
                    const result = await this.godMode.executeCommand('nircmd.exe changesysvolume -2000');
                    return `🔉 Volume decreased`;
                }
            }

            // Screenshot
            if (msg.includes('screenshot') || msg.includes('screen shot')) {
                const result = await this.godMode.executeCommand('snippingtool /clip');
                return `📸 Taking screenshot...`;
            }

            // Shutdown/Restart
            if (msg.includes('shutdown') || msg.includes('turn off')) {
                return `⚠️ Shutdown command detected. Send "confirm shutdown" to proceed.`;
            }

            if (msg.includes('confirm shutdown')) {
                const result = await this.godMode.executeCommand('shutdown /s /t 30');
                return `🔴 Shutting down in 30 seconds...\n\n${result}`;
            }

            if (msg.includes('restart') || msg.includes('reboot')) {
                return `⚠️ Restart command detected. Send "confirm restart" to proceed.`;
            }

            if (msg.includes('confirm restart')) {
                const result = await this.godMode.executeCommand('shutdown /r /t 30');
                return `🔄 Restarting in 30 seconds...\n\n${result}`;
            }

            // ========================================
            // DEFAULT: Unknown command
            // ========================================
            return `⚠️ Command not recognized: "${userMessage}"\n\nTry:\n- "open youtube and play [song]"\n- "create folder [name]"\n- "open calculator"\n- "list files"`;

        } catch (error) {
            const errorMsg = error.message || String(error);
            console.error('[God Mode] Error:', errorMsg);
            console.error('[God Mode] Error stack:', error.stack);
            
            // Handle specific error types
            if (errorMsg.includes('detached') || errorMsg.includes('closed')) {
                console.warn('[God Mode] Connection-related error - user browser may have been closed');
                return `⚠️ Browser connection lost. The browser may have been closed.\nTry reopening it or restarting God Mode.`;
            }
            
            return `❌ Error executing command: ${errorMsg}`;
        }
    }
}

module.exports = DirectGodModeAgent;
