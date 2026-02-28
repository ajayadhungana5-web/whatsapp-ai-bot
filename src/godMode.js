const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execPromise = util.promisify(exec);

class GodMode {
    constructor() {
        this.cwd = process.cwd(); // Track current working directory
        this.activeBrowser = null; // Track active browser instance
        this.activePage = null; // Track active page
        this.browserId = null; // For managing browser sessions
    }

    /**
     * Execute a shell command
     */
    async executeCommand(command) {
        try {
            console.log(`[GodMode] Executing: ${command} in ${this.cwd}`);
            const { stdout, stderr } = await execPromise(command, { cwd: this.cwd, maxBuffer: 1024 * 1024 * 10 }); // 10MB buffer

            // If command was a 'cd', we need to manually track it because child_process spawn is ephemeral
            if (command.trim().startsWith('cd ')) {
                const target = command.trim().split(' ')[1];
                this.cwd = path.resolve(this.cwd, target);
                return `Changed directory to: ${this.cwd}`;
            }

            if (stderr) {
                return `Stdout:\n${stdout}\n\nStderr:\n${stderr}`;
            }
            return stdout || "(Command executed with no output)";
        } catch (error) {
            return `Execution Error: ${error.message}`;
        }
    }

    /**
     * Write file content
     */
    async writeFile(filePath, content) {
        try {
            const absolutePath = path.resolve(this.cwd, filePath);
            // Ensure dir exists
            const dir = path.dirname(absolutePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(absolutePath, content);
            return `File written to: ${absolutePath}`;
        } catch (error) {
            return `Write Error: ${error.message}`;
        }
    }

    /**
     * Read file content
     */
    async readFile(filePath) {
        try {
            const absolutePath = path.resolve(this.cwd, filePath);
            if (!fs.existsSync(absolutePath)) return "File not found.";
            return fs.readFileSync(absolutePath, 'utf8');
        } catch (error) {
            return `Read Error: ${error.message}`;
        }
    }

    /**
     * List files
     */
    async listFiles(dirPath = '.') {
        try {
            const absolutePath = path.resolve(this.cwd, dirPath);
            const files = fs.readdirSync(absolutePath);
            return `Files in ${absolutePath}:\n${files.join('\n')}`;
        } catch (error) {
            return `List Error: ${error.message}`;
        }
    }

    /**
     * Open an application or URL
     */
    async openApp(target) {
        try {
            // Windows 'start' command
            await execPromise(`start "" "${target}"`);
            return `Opened: ${target}`;
        } catch (error) {
            return `Open Error: ${error.message}`;
        }
    }

    /**
     * Advanced browser automation with persistent session
     */
    /**
     * Advanced browser automation with persistent session
     */
    async browserAutomate(url, actions = [], browserType = 'chrome', profile = null) {
        try {
            const puppeteer = require('puppeteer');
            console.log(`[GodMode] Launching browser (${browserType}) with profile: ${profile || 'Temporary'}`);

            // Use different executable paths based on browser type
            let executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
            if (browserType.toLowerCase().includes('brave')) {
                executablePath = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
            } else if (browserType.toLowerCase().includes('edge')) {
                executablePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
            }

            // Configure Launch Options - STEALTH MODE
            const launchOptions = {
                headless: false,
                executablePath: executablePath,
                ignoreDefaultArgs: ['--enable-automation'], // Crucial to hide "Chrome is being controlled by automated software"
                args: [
                    '--start-maximized',
                    '--no-sandbox',

                    '--disable-blink-features=AutomationControlled', // Hides automation flag from navigator
                    '--disable-infobars'
                ],
                defaultViewport: null
            };

            // Use User Data Dir if profile is requested
            if (profile) {
                const os = require('os');
                const userDataRoot = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');

                // IMPORTANT: Puppeteer points to the ROOT User Data dir, and uses --profile-directory to select the specific one
                launchOptions.userDataDir = userDataRoot;
                launchOptions.args.push(`--profile-directory=${profile}`);
            }

            // Reuse existing browser if available and connected
            if (this.activeBrowser) {
                if (!this.activeBrowser.isConnected()) {
                    console.log('[GodMode] Existing browser disconnected. Resetting.');
                    this.activeBrowser = null;
                    this.activePage = null;
                } else {
                    // Check if profile matches? (Hard to check efficiently, assuming user intention is valid for now)
                    console.log('[GodMode] Reusing existing browser instance');
                }
            }

            if (!this.activeBrowser) {
                try {
                    this.activeBrowser = await puppeteer.launch(launchOptions);

                    // Cleanup on manual close
                    this.activeBrowser.on('disconnected', () => {
                        console.log('[GodMode] Browser disconnected (closed manually or crashed).');
                        this.activeBrowser = null;
                        this.activePage = null;
                    });

                } catch (launchError) {
                    console.warn('[GodMode] Puppeteer Launch Failed:', launchError.message);

                    // FALLBACK: If Puppeteer fails (locked profile/devtools error), try standard system launch
                    // This allows "Opening" the profile even if we can't automate it.
                    if (launchError.message.includes('user data directory is already in use') ||
                        launchError.message.includes('DevTools remote debugging')) {

                        console.log('[GodMode] Falling back to system start (Automation Limited).');

                        // Construct user-friendly system command
                        // 'start chrome' works on Windows.
                        // We need the URL (or empty) and profile arg.
                        const profileArg = profile ? `--profile-directory="${profile}"` : '';
                        const targetUrl = url || 'about:blank';
                        const cmd = `start chrome "${targetUrl}" ${profileArg}`;

                        try {
                            await this.executeCommand(cmd);
                            return `⚠️ Opened Chrome via system (Profile locked). Automation limited (clicks/typing may not work).`;
                        } catch (sysErr) {
                            throw new Error(`Both Puppeteer and System Launch failed: ${sysErr.message}`);
                        }
                    }
                    throw launchError;
                }
                console.log('[GodMode] New browser instance created');
            }

            // Create or reuse page
            try {
                if (this.activePage && this.activePage.isClosed()) {
                    this.activePage = null;
                }

                if (!this.activePage) {
                    const pages = await this.activeBrowser.pages();
                    // If we have pages, use the first one (often the new tab page or restored tab)
                    this.activePage = pages.length > 0 ? pages[0] : await this.activeBrowser.newPage();
                }

                // STEALTH: Remove webdriver property
                await this.activePage.evaluateOnNewDocument(() => {
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                    });
                });

                // Verify page is alive
                await this.activePage.title();
            } catch (e) {
                console.log('[GodMode] Active page stale, creating new one.');
                this.activePage = await this.activeBrowser.newPage();
            }

            if (url) {
                console.log(`[GodMode] Navigating to: ${url}`);
                try {
                    await this.activePage.goto(url, { waitUntil: 'load', timeout: 60000 }); // 'load' might be more reliable than networkidle2 for some sites
                } catch (navError) {
                    console.error(`[GodMode] Navigation Failed: ${navError.message}`);
                    return `Navigation Failed: ${navError.message}`;
                }
            } else {
                console.log('[GodMode] No URL provided, staying on current page.');
            }

            // Execute actions (e.g., click, type, wait)
            for (const action of actions) {
                if (action.type === 'click') {
                    try {
                        let selector = action.selector;
                        if (selector.startsWith('text=')) {
                            const text = selector.split('=')[1];
                            await this.activePage.evaluate((searchText) => {
                                const elements = [...document.querySelectorAll('*')];
                                const el = elements.find(e => e.innerText && e.innerText.includes(searchText) && e.offsetParent !== null);
                                if (el) el.click();
                            }, text);
                        } else {
                            await this.activePage.waitForSelector(action.selector, { timeout: 10000 });
                            await this.activePage.click(action.selector);
                        }
                        console.log(`[GodMode] Clicked: ${action.selector}`);
                    } catch (e) {
                        console.log(`[GodMode] Could not find selector: ${action.selector}`);
                    }
                } else if (action.type === 'type') {
                    await this.activePage.type(action.selector, action.text);
                    console.log(`[GodMode] Typed: ${action.text}`);
                } else if (action.type === 'wait') {
                    await new Promise(r => setTimeout(r, action.ms));
                } else if (action.type === 'scroll') {
                    await this.activePage.evaluate(() => window.scrollBy(0, window.innerHeight));
                }
            }

            console.log('[GodMode] Browser automation complete. Keeping browser open.');
            return `Browser automated. Actions completed: ${actions.length}`;

        } catch (error) {
            console.error('[GodMode] Browser Automation Error:', error);
            return `Browser Automation Error: ${error.message}`;
        }
    }

    /**
     * Navigate back in browser history
     */
    async browserBack() {
        try {
            if (!this.activePage) {
                return '⚠️ No active browser session. Open a browser first.';
            }
            await this.activePage.goBack({ waitUntil: 'networkidle2', timeout: 30000 });
            return '⬅️ Navigated back';
        } catch (error) {
            return `Navigation Error: ${error.message}`;
        }
    }

    /**
     * Navigate forward in browser history
     */
    async browserForward() {
        try {
            if (!this.activePage) {
                return '⚠️ No active browser session. Open a browser first.';
            }
            await this.activePage.goForward({ waitUntil: 'networkidle2', timeout: 30000 });
            return '➡️ Navigated forward';
        } catch (error) {
            return `Navigation Error: ${error.message}`;
        }
    }

    /**
     * Reload current page
     */
    async browserReload() {
        try {
            if (!this.activePage) {
                return '⚠️ No active browser session. Open a browser first.';
            }
            await this.activePage.reload({ waitUntil: 'networkidle2', timeout: 30000 });
            return '🔄 Page reloaded';
        } catch (error) {
            return `Navigation Error: ${error.message}`;
        }
    }

    /**
     * Close browser with proper error handling
     */
    async browserClose() {
        try {
            if (this.activeBrowser) {
                try {
                    console.log('[GodMode] Closing browser safely...');
                    // Add a short timeout to prevent hanging
                    const closePromise = this.activeBrowser.close();
                    await Promise.race([
                        closePromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Browser close timeout')), 5000))
                    ]);
                    console.log('[GodMode] Browser closed successfully');
                } catch (closeError) {
                    console.warn('[GodMode] Error during browser close:', closeError.message);
                    // Even if close fails, clean up references
                }
                this.activeBrowser = null;
                this.activePage = null;
                return '✅ Browser closed';
            }
            return '⚠️ No active browser session';
        } catch (error) {
            console.error('[GodMode] Browser close error:', error.message);
            // Always clean up even if there's an error
            this.activeBrowser = null;
            this.activePage = null;
            return `✅ Browser cleanup completed (${error.message})`;
        }
    }

    /**
     * Close current tab/page with proper error handling
     */
    async browserCloseTab() {
        try {
            if (this.activePage) {
                try {
                    console.log('[GodMode] Closing tab safely...');
                    // Add timeout to prevent hanging
                    const closePromise = this.activePage.close();
                    await Promise.race([
                        closePromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Tab close timeout')), 5000))
                    ]);
                    console.log('[GodMode] Tab closed successfully');
                } catch (closeError) {
                    console.warn('[GodMode] Error during tab close:', closeError.message);
                }
                this.activePage = null;
                return '✅ Tab closed';
            }
            return '⚠️ No active tab';
        } catch (error) {
            console.error('[GodMode] Tab close error:', error.message);
            // Always clean up even if there's an error
            this.activePage = null;
            return `✅ Tab cleanup completed (${error.message})`;
        }
    }

    /**
     * Navigate to a URL
     */
    async browserNavigate(url) {
        try {
            if (!this.activeBrowser) {
                // Open browser if not open
                const puppeteer = require('puppeteer');
                this.activeBrowser = await puppeteer.launch({
                    headless: false,
                    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                    args: ['--start-maximized']
                });
                this.activePage = await this.activeBrowser.newPage();
            }

            await this.activePage.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            return `✅ Navigated to ${url}`;
        } catch (error) {
            return `Navigation Error: ${error.message}`;
        }
    }

    /**
     * Search the web
     */
    async webSearch(query) {
        try {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            return await this.browserNavigate(searchUrl);
        } catch (error) {
            return `Search Error: ${error.message}`;
        }
    }

    /**
     * Open YouTube and play a video
     */
    async youtubePlay(query) {
        try {
            const searchUrl = `https://youtube.com/results?search_query=${encodeURIComponent(query)}`;
            await this.browserAutomate(searchUrl, [
                { type: 'wait', ms: 3000 },
                { type: 'click', selector: 'ytd-video-renderer a#video-title' }
            ]);
            return `🎵 Playing "${query}" on YouTube`;
        } catch (error) {
            return `YouTube Error: ${error.message}`;
        }
    }

    // ===============================================
    // FILE & FOLDER OPERATIONS
    // ===============================================

    /**
     * Delete a file
     */
    async deleteFile(filePath) {
        try {
            const absolutePath = path.resolve(this.cwd, filePath);
            if (!fs.existsSync(absolutePath)) {
                return `❌ File not found: ${filePath}`;
            }
            fs.unlinkSync(absolutePath);
            return `🗑️ File deleted: ${filePath}`;
        } catch (error) {
            return `Delete Error: ${error.message}`;
        }
    }

    /**
     * Delete a folder and all contents
     */
    async deleteFolder(folderPath) {
        try {
            const absolutePath = path.resolve(this.cwd, folderPath);
            if (!fs.existsSync(absolutePath)) {
                return `❌ Folder not found: ${folderPath}`;
            }
            fs.rmSync(absolutePath, { recursive: true, force: true });
            return `🗑️ Folder deleted: ${folderPath}`;
        } catch (error) {
            return `Delete Error: ${error.message}`;
        }
    }

    /**
     * Copy a file
     */
    async copyFile(source, destination) {
        try {
            const srcPath = path.resolve(this.cwd, source);
            const destPath = path.resolve(this.cwd, destination);

            if (!fs.existsSync(srcPath)) {
                return `❌ Source file not found: ${source}`;
            }

            // Ensure destination directory exists
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            fs.copyFileSync(srcPath, destPath);
            return `📋 File copied: ${source} → ${destination}`;
        } catch (error) {
            return `Copy Error: ${error.message}`;
        }
    }

    /**
     * Move/Rename a file
     */
    async moveFile(source, destination) {
        try {
            const srcPath = path.resolve(this.cwd, source);
            const destPath = path.resolve(this.cwd, destination);

            if (!fs.existsSync(srcPath)) {
                return `❌ Source file not found: ${source}`;
            }

            // Ensure destination directory exists
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            fs.renameSync(srcPath, destPath);
            return `➡️ File moved: ${source} → ${destination}`;
        } catch (error) {
            return `Move Error: ${error.message}`;
        }
    }

    /**
     * Create a folder
     */
    async createFolder(folderPath) {
        try {
            const absolutePath = path.resolve(this.cwd, folderPath);
            if (fs.existsSync(absolutePath)) {
                return `⚠️ Folder already exists: ${folderPath}`;
            }
            fs.mkdirSync(absolutePath, { recursive: true });
            return `📁 Folder created: ${folderPath}`;
        } catch (error) {
            return `Create Error: ${error.message}`;
        }
    }

    /**
     * Get file size
     */
    async getFileSize(filePath) {
        try {
            const absolutePath = path.resolve(this.cwd, filePath);
            if (!fs.existsSync(absolutePath)) {
                return `❌ File not found: ${filePath}`;
            }
            const stats = fs.statSync(absolutePath);
            const sizeInBytes = stats.size;
            const sizeInKB = (sizeInBytes / 1024).toFixed(2);
            const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);
            return `📊 File size: ${sizeInBytes} bytes (${sizeInKB} KB / ${sizeInMB} MB)`;
        } catch (error) {
            return `Size Error: ${error.message}`;
        }
    }

    /**
     * Check if file/folder exists
     */
    async fileExists(filePath) {
        try {
            const absolutePath = path.resolve(this.cwd, filePath);
            return fs.existsSync(absolutePath) ? `✅ Exists: ${filePath}` : `❌ Does not exist: ${filePath}`;
        } catch (error) {
            return `Check Error: ${error.message}`;
        }
    }

    /**
     * Get folder size (recursive)
     */
    async getFolderSize(folderPath) {
        try {
            const absolutePath = path.resolve(this.cwd, folderPath);
            if (!fs.existsSync(absolutePath)) {
                return `❌ Folder not found: ${folderPath}`;
            }

            let totalSize = 0;
            const walkDir = (dir) => {
                const files = fs.readdirSync(dir);
                files.forEach(file => {
                    const filePath = path.join(dir, file);
                    const stats = fs.statSync(filePath);
                    if (stats.isDirectory()) {
                        walkDir(filePath);
                    } else {
                        totalSize += stats.size;
                    }
                });
            };

            walkDir(absolutePath);
            const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
            return `📦 Folder size: ${sizeInMB} MB`;
        } catch (error) {
            return `Size Error: ${error.message}`;
        }
    }

    /**
     * Rename a file or folder
     */
    async rename(oldName, newName) {
        try {
            const oldPath = path.resolve(this.cwd, oldName);
            const newPath = path.resolve(this.cwd, newName);

            if (!fs.existsSync(oldPath)) {
                return `❌ File/Folder not found: ${oldName}`;
            }

            fs.renameSync(oldPath, newPath);
            return `✏️ Renamed: ${oldName} → ${newName}`;
        } catch (error) {
            return `Rename Error: ${error.message}`;
        }
    }

    // ===============================================
    // WINDOW MANAGEMENT
    // ===============================================

    /**
     * Close an application by name
     */
    async closeApp(appName) {
        try {
            const taskKillCmd = `taskkill /IM ${appName}.exe /F`;
            const { stdout, stderr } = await execPromise(taskKillCmd);
            if (stderr && !stderr.includes('SUCCESS')) {
                return `⚠️ Could not close ${appName}`;
            }
            return `✅ Closed: ${appName}`;
        } catch (error) {
            return `Close Error: ${error.message}`;
        }
    }

    /**
     * Get list of running processes
     */
    async listRunningProcesses() {
        try {
            const { stdout } = await execPromise('tasklist');
            return `Running Processes:\n${stdout}`;
        } catch (error) {
            return `Process Error: ${error.message}`;
        }
    }

    /**
     * Get system information
     */
    async getSystemInfo() {
        try {
            const { stdout } = await execPromise('systeminfo');
            return stdout;
        } catch (error) {
            return `System Error: ${error.message}`;
        }
    }

    /**
     * Minimize all windows
     */
    async minimizeAllWindows() {
        try {
            await execPromise('powershell -Command "[Windows.ApplicationModel.Core.CoreApplication]::MainView.CoreWindow.IsVisible = $false"', { shell: 'powershell' });
            return 'All windows minimized';
        } catch (error) {
            // Fallback
            return 'Could not minimize all windows';
        }
    }

    /**
     * Get current user
     */
    async getCurrentUser() {
        try {
            const { stdout } = await execPromise('whoami');
            return `Current User: ${stdout.trim()}`;
        } catch (error) {
            return `User Error: ${error.message}`;
        }
    }

    /**
     * Get disk usage
     */
    async getDiskUsage() {
        try {
            const { stdout } = await execPromise('wmic logicaldisk get name,freespace,size');
            return `Disk Usage:\n${stdout}`;
        } catch (error) {
            return `Disk Error: ${error.message}`;
        }
    }

    /**
     * Open file with default application
     */
    async openFileDefault(filePath) {
        try {
            const absolutePath = path.resolve(this.cwd, filePath);
            if (!fs.existsSync(absolutePath)) {
                return `❌ File not found: ${filePath}`;
            }
            await execPromise(`start "" "${absolutePath}"`);
            return `📂 Opened: ${filePath}`;
        } catch (error) {
            return `Open Error: ${error.message}`;
        }
    }

    /**
     * Search for files matching a pattern
     */
    async searchFiles(pattern, searchDir = '.') {
        try {
            const absolutePath = path.resolve(this.cwd, searchDir);
            if (!fs.existsSync(absolutePath)) {
                return `❌ Directory not found: ${searchDir}`;
            }

            const results = [];
            const walkDir = (dir) => {
                const files = fs.readdirSync(dir);
                files.forEach(file => {
                    const filePath = path.join(dir, file);
                    if (file.includes(pattern)) {
                        results.push(filePath);
                    }
                    const stats = fs.statSync(filePath);
                    if (stats.isDirectory()) {
                        walkDir(filePath);
                    }
                });
            };

            walkDir(absolutePath);
            return results.length > 0 ? `Found: \n${results.join('\n')}` : `No files found matching: ${pattern}`;
        } catch (error) {
            return `Search Error: ${error.message}`;
        }
    }

    /**
     * Append content to a file
     */
    async appendFile(filePath, content) {
        try {
            const absolutePath = path.resolve(this.cwd, filePath);
            fs.appendFileSync(absolutePath, content + '\n');
            return `✍️ Content appended to: ${filePath}`;
        } catch (error) {
            return `Append Error: ${error.message}`;
        }
    }

    /**
     * Clear screen
     */
    async clearScreen() {
        try {
            await execPromise('cls');
            return 'Screen cleared';
        } catch (error) {
            return 'Could not clear screen';
        }
    }

    /**
     * Download a file (simple)
     */
    async note(title, content) {
        try {
            const notePath = path.resolve(this.cwd, `${title}.txt`);
            fs.writeFileSync(notePath, content);
            return `📝 Note saved: ${title}.txt`;
        } catch (error) {
            return `Note Error: ${error.message}`;
        }
    }

    /**
     * Get available Chrome Profiles
     */
    async getChromeProfiles() {
        try {
            const os = require('os');
            const fs = require('fs');
            const userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');

            if (!fs.existsSync(userDataDir)) {
                return [];
            }

            // Look for "Default" and "Profile *" folders
            // AND sort by modification time to find most recently used
            let profileList = [];

            try {
                const dirs = fs.readdirSync(userDataDir);

                for (const dir of dirs) {
                    if (dir === 'Default' || dir.startsWith('Profile ')) {
                        try {
                            // Check Preferences file modification time (most reliable for activity)
                            const prefPath = path.join(userDataDir, dir, 'Preferences');
                            let mtime = 0;

                            if (fs.existsSync(prefPath)) {
                                const stats = fs.statSync(prefPath);
                                mtime = stats.mtimeMs;
                            } else {
                                // Fallback to directory mtime
                                const stats = fs.statSync(path.join(userDataDir, dir));
                                mtime = stats.mtimeMs;
                            }

                            profileList.push({ name: dir, mtime: mtime });
                        } catch (accessErr) {
                            // Skip inaccessible folders
                        }
                    }
                }

                // Sort by newest first (descending mtime)
                profileList.sort((a, b) => b.mtime - a.mtime);

                return profileList.map(p => p.name);
            } catch (readErr) {
                console.warn('Could not read user data dir:', readErr);
                return [];
            }
        } catch (error) {
            console.error('Error fetching profiles:', error);
            return [];
        }
    }

    /**
     * Get file info
     */
    async getFileInfo(filePath) {
        try {
            const absolutePath = path.resolve(this.cwd, filePath);
            if (!fs.existsSync(absolutePath)) {
                return `❌ File not found: ${filePath}`;
            }
            const stats = fs.statSync(absolutePath);
            return `📄 File Info:
- Name: ${path.basename(filePath)}
- Size: ${stats.size} bytes
- Created: ${stats.birthtime}
- Modified: ${stats.mtime}
- Is Directory: ${stats.isDirectory()}`;
        } catch (error) {
            return `Info Error: ${error.message}`;
        }
    }
    /**
     * Download a file from URL
     */
    async downloadFile(url, fileName) {
        try {
            const https = require('https');
            const file = fs.createWriteStream(path.resolve(this.cwd, fileName));

            return new Promise((resolve, reject) => {
                https.get(url, function (response) {
                    response.pipe(file);
                    file.on('finish', function () {
                        file.close(() => resolve(`✅ Downloaded: ${fileName}`));
                    });
                }).on('error', function (err) {
                    fs.unlink(fileName, () => { }); // Delete the file async. (But we don't check the result)
                    reject(`Download Error: ${err.message}`);
                });
            });
        } catch (error) {
            return `Download Error: ${error.message}`;
        }
    }

    /**
     * Get text content from active browser page
     */
    async getPageContent() {
        try {
            if (!this.activePage) {
                return '⚠️ No active browser session.';
            }
            const content = await this.activePage.evaluate(() => document.body.innerText);
            return `📄 Page Content (preview):\n\n${content.substring(0, 2000)}...`;
        } catch (error) {
            return `Content Error: ${error.message}`;
        }
    }

    /**
     * Execute arbitrary Node.js script (Dynamic Learning)
     */
    async executeScript(scriptContent) {
        try {
            const tempFile = `temp_script_${Date.now()}.js`;
            await this.writeFile(tempFile, scriptContent);

            const result = await this.executeCommand(`node ${tempFile}`);

            // Cleanup
            await this.deleteFile(tempFile);

            return result;
        } catch (error) {
            return `Script Execution Error: ${error.message}`;
        }
    }
}

module.exports = GodMode;
