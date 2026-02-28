const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/**
 * Platform-Agnostic Configuration Manager
 * Handles Windows, Linux, Mac - automatically
 */
class ConfigManager {
    constructor() {
        this.platform = os.platform();
        this.arch = os.arch();
        this.homeDir = os.homedir();
        
        console.log(`[ConfigManager] Platform: ${this.platform} (${this.arch})`);
    }

    /**
     * Find Chrome/Chromium executable for any platform
     */
    async findChromePath() {
        const platform = this.platform;
        
        const candidates = {
            win32: [
                path.join('C:\\', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
                path.join('C:\\', 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
                this.findInProgramFiles('Chrome'),
                this.findInProgramFiles('Chromium'),
            ],
            darwin: [  // macOS
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Chromium.app/Contents/MacOS/Chromium',
                '/usr/local/bin/chrome',
                '/usr/local/bin/chromium',
            ],
            linux: [
                '/usr/bin/google-chrome',
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
                '/snap/bin/chromium',
                '/usr/local/bin/chrome',
            ]
        };

        const pathsToCheck = candidates[platform] || candidates.linux;

        for (const chromePath of pathsToCheck) {
            if (chromePath && fs.existsSync(chromePath)) {
                console.log(`[ConfigManager] Found Chrome at: ${chromePath}`);
                return chromePath;
            }
        }

        // Fallback: let puppeteer auto-detect
        console.warn('[ConfigManager] Chrome not found in standard locations, using puppeteer auto-detect');
        return undefined;
    }

    /**
     * Find program in Program Files (Windows only)
     */
    findInProgramFiles(programName) {
        if (this.platform !== 'win32') return null;

        const possibleDirs = [
            path.join('C:\\', 'Program Files', programName),
            path.join('C:\\', 'Program Files (x86)', programName),
        ];

        for (const dir of possibleDirs) {
            if (fs.existsSync(dir)) {
                return dir;
            }
        }

        return null;
    }

    /**
     * Get Puppeteer args based on platform
     */
    getPuppeteerArgs() {
        const commonArgs = [
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled'
        ];

        if (this.platform === 'win32') {
            return [
                ...commonArgs,
                '--no-sandbox',

                '--disable-dev-shm-usage',
                '--disable-gpu',
            ];
        }

        if (this.platform === 'linux') {
            return [
                ...commonArgs,
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
            ];
        }

        // macOS
        return commonArgs;
    }

    /**
     * Get data directory (platform-specific, respects OS conventions)
     */
    getDataDir() {
        const platform = this.platform;

        if (platform === 'win32') {
            // Windows: Use AppData or project directory
            return process.env.LOCALAPPDATA 
                ? path.join(process.env.LOCALAPPDATA, 'whatsapp-bot')
                : path.join(__dirname, '../../data');
        }

        if (platform === 'darwin') {
            // macOS: Use ~/Library/Application Support
            return path.join(this.homeDir, 'Library', 'Application Support', 'whatsapp-bot');
        }

        // Linux: Use ~/.local/share
        return path.join(this.homeDir, '.local', 'share', 'whatsapp-bot');
    }

    /**
     * Get logs directory
     */
    getLogsDir() {
        const dataDir = this.getDataDir();
        return path.join(dataDir, 'logs');
    }

    /**
     * Ensure directories exist
     */
    ensureDirectories() {
        const dirs = [
            this.getDataDir(),
            this.getLogsDir(),
            path.join(this.getDataDir(), 'conversations'),
            path.join(this.getDataDir(), 'backups'),
            path.join(this.getDataDir(), 'cache'),
            path.join(this.getDataDir(), 'analytics'),
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    /**
     * Get system info
     */
    getSystemInfo() {
        return {
            platform: this.platform,
            arch: this.arch,
            nodejs: process.version,
            cpus: os.cpus().length,
            memory: {
                total: Math.round(os.totalmem() / 1024 / 1024) + ' MB',
                free: Math.round(os.freemem() / 1024 / 1024) + ' MB'
            },
            hostname: os.hostname(),
            userHome: this.homeDir
        };
    }

    /**
     * Check system requirements
     */
    checkSystemRequirements() {
        const issues = [];

        // Check Node version
        const nodeVersion = process.versions.node;
        const majorVersion = parseInt(nodeVersion.split('.')[0]);
        if (majorVersion < 14) {
            issues.push('Node.js version should be 14+');
        }

        // Check memory
        const freeMemMB = os.freemem() / 1024 / 1024;
        if (freeMemMB < 512) {
            issues.push('Less than 512MB free memory available');
        }

        // Check Chrome availability
        if (!this.findChromePath()) {
            console.warn('[ConfigManager] Chrome not found');
            issues.push('Chrome/Chromium not found (will try auto-detect)');
        }

        return {
            passed: issues.length === 0,
            issues,
            warnings: issues.filter(i => !i.includes('will try')),
            system: this.getSystemInfo()
        };
    }

    /**
     * Print system diagnostics
     */
    printDiagnostics() {
        console.log('\n' + '='.repeat(60));
        console.log('🔧 SYSTEM DIAGNOSTICS');
        console.log('='.repeat(60));

        const sysInfo = this.getSystemInfo();
        console.log(`Platform: ${sysInfo.platform} (${sysInfo.arch})`);
        console.log(`Node.js: ${sysInfo.nodejs}`);
        console.log(`CPUs: ${sysInfo.cpus}`);
        console.log(`Memory: ${sysInfo.memory.total} (Free: ${sysInfo.memory.free})`);
        console.log(`Home: ${sysInfo.userHome}`);

        const requirements = this.checkSystemRequirements();
        if (requirements.passed) {
            console.log('\n✅ All requirements met!');
        } else {
            console.log('\n⚠️  Issues found:');
            requirements.issues.forEach(issue => console.log(`  - ${issue}`));
        }

        console.log('='.repeat(60) + '\n');
    }
}

module.exports = ConfigManager;
