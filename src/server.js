const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// State Management
let botState = {
    messageCount: 0,
    totalUsers: 0,
    activeUsers: [], // Array of unique sender IDs to persist across restarts
    startTime: null,
    tasks: [],
    qrCode: null,
    lastQRTime: null,
    pid: null,
    system: {
        cpu: 0,
        memory: 0,
        storage: 0
    },
    outreach: {
        total: 0,
        success: 0,
        failed: 0,
        running: false
    },
    commandQueue: [] // Commands for the bot to pick up via polling
};

let botProcess = null;

const configFile = path.join(__dirname, '../config/bot-config.json');

// Load config on startup
function loadConfig() {
    try {
        if (fs.existsSync(configFile)) {
            const data = fs.readFileSync(configFile, 'utf8');
            botState = { ...botState, ...JSON.parse(data) };
            if (!Array.isArray(botState.activeUsers)) botState.activeUsers = [];
        }
    } catch (err) {
        console.error('Error loading config:', err);
    }
}

// Save config
function saveConfig() {
    try {
        fs.writeFileSync(configFile, JSON.stringify(botState, null, 2));
    } catch (err) {
        console.error('Error saving config:', err);
    }
}

// API Endpoints

// Get Combined Stats (Real-time)
app.get('/api/stats', (req, res) => {
    const os = require('os');

    // Calculate uptime
    const uptime = botState.running && botState.startTime
        ? Math.floor((Date.now() - botState.startTime) / 1000)
        : 0;

    // CPU estimation
    const cpus = os.cpus();
    const load = os.loadavg();
    const cpuUsage = Math.min(100, Math.floor((load[0] / cpus.length) * 100));

    // Memory Usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = Math.floor(((totalMem - freeMem) / totalMem) * 100);

    res.json({
        status: botState.whatsappConnected ? 'connected' : (botState.running ? 'waiting_qr' : 'stopped'),
        uptime: uptime,
        messages: botState.messageCount,
        users: botState.activeUsers ? botState.activeUsers.length : 0,
        cpu: cpuUsage,
        memory: memUsage
    });
});

// Get bot status
app.get('/api/bot/status', (req, res) => {
    const uptime = botState.running && botState.startTime
        ? Math.floor((Date.now() - botState.startTime) / 1000)
        : 0;

    res.json({
        status: botState.running ? 'running' : 'stopped',
        running: botState.running,
        uptime: uptime,
        messageCount: botState.messageCount,
        totalUsers: botState.activeUsers ? botState.activeUsers.length : 0,
        whatsappConnected: botState.whatsappConnected,
        profile: botState.profile?.name || 'Not configured'
    });
});

// Get QR Code
app.get('/api/bot/qr', (req, res) => {
    res.json({
        qrCode: botState.qrCode,
        whatsappConnected: botState.whatsappConnected
    });
});

// Get System Health (Real Data)
app.get('/api/system/health', (req, res) => {
    const os = require('os');
    const fs = require('fs');

    // CPU Load estimation (simplified)
    const cpus = os.cpus();
    const load = os.loadavg();
    const cpuUsage = Math.min(100, Math.floor((load[0] / cpus.length) * 100));

    // Memory Usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = Math.floor(((totalMem - freeMem) / totalMem) * 100);

    // Storage (mocking for now as full disk check is slow, but using real file sizes)
    let storageProgress = 15;
    try {
        const stats = fs.statSync(path.join(__dirname, '..'));
        storageProgress = Math.min(100, Math.floor((stats.size / 1024 / 1024 / 10))); // Scaled for demo
    } catch (e) { }

    res.json({
        cpu: cpuUsage,
        memory: memUsage,
        storage: storageProgress + 10 // Base offset
    });
});

// Save Profile
app.post('/api/profile', (req, res) => {
    botState.profile = req.body;
    saveConfig();
    res.json({ success: true, message: 'Profile saved' });
});

// Save AI Config
app.post('/api/ai-config', (req, res) => {
    botState.aiConfig = req.body;
    saveConfig();
    res.json({ success: true, message: 'AI config saved' });
});

// Test AI Connection
app.post('/api/test-ai', async (req, res) => {
    try {
        const config = req.body;

        if (config.provider === 'openai') {
            const openai = new OpenAI({ apiKey: config.openai.apiKey });
            await openai.chat.completions.create({
                model: config.openai.model || 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: 'Hello' }],
                max_tokens: 10
            });
            res.json({ success: true, message: 'OpenAI connection successful' });
        } else if (config.provider === 'gemini') {
            const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
            await model.generateContent('Hello');
            res.json({ success: true, message: 'Gemini connection successful' });
        }
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Start Bot
app.post('/api/bot/start', async (req, res) => {
    try {
        // Check if bot process exists and is still running
        if (botState.running && botProcess && !botProcess.killed) {
            return res.json({ success: false, error: 'Bot is already running' });
        }

        // If bot is marked as running but process is dead, clean up
        if (botState.running && (!botProcess || botProcess.killed)) {
            botState.running = false;
            botState.whatsappConnected = false;
            botState.pid = null;
            botProcess = null;
        }

        // Use provided profile/config or fall back to existing state
        if (req.body.profile) botState.profile = req.body.profile;
        if (req.body.aiConfig) botState.aiConfig = req.body.aiConfig;

        // Ensure profile exists to avoid crash
        if (!botState.profile) botState.profile = { name: 'Default Bot' };

        // Spawn the bot process
        const botPath = path.join(__dirname, 'index.js');
        const logStream = fs.createWriteStream(path.join(__dirname, '../logs/bot.log'), { flags: 'a' });

        botProcess = spawn('node', ['src/index.js'], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, AI_PROVIDER: botState.aiConfig?.provider || 'personal' },
            stdio: ['inherit', 'pipe', 'pipe', 'ipc']
        });

        botProcess.stdout.pipe(logStream);
        botProcess.stderr.pipe(logStream);

        botState.running = true;
        botState.startTime = Date.now();
        botState.messageCount = 0;
        botState.whatsappConnected = false;
        botState.pid = botProcess.pid;

        const child = botProcess;
        botProcess.on('exit', (code) => {
            console.log(`Bot process exited with code ${code}`);

            // Only update state if this is the current process
            if (botProcess === child) {
                botState.running = false;
                botState.whatsappConnected = false;
                botState.pid = null;
                botProcess = null;
                logEvent(`Bot process stopped (exit code: ${code})`, 'info');
            }
        });

        botProcess.on('message', (msg) => {
            if (msg.type === 'message-received') {
                const { from } = msg;
                botState.messageCount++;
                if (from) {
                    if (!Array.isArray(botState.activeUsers)) botState.activeUsers = [];
                    if (!botState.activeUsers.includes(from)) {
                        botState.activeUsers.push(from);
                        // Cap at 1000 users to prevent infinite growth
                        if (botState.activeUsers.length > 1000) {
                            botState.activeUsers.shift();
                        }
                    }
                    saveConfig();
                }
            } else if (msg.type === 'outreach-results') {
                const { success, failed } = msg.results;
                botState.outreach.success = success;
                botState.outreach.failed = failed;
                botState.outreach.running = false;
                logEvent(`Outreach Completed: ${success} sent, ${failed} failed`, success > 0 ? 'success' : 'error', 'outreach');
            }
        });

        saveConfig();

        logEvent('Bot started via dashboard with profile: ' + (botState.profile.name || 'Unknown'), 'success');

        res.json({
            success: true,
            message: 'Bot started successfully',
            pid: botProcess.pid
        });

    } catch (err) {
        console.error('Error starting bot:', err);
        // Ensure we don't try to send headers twice
        if (!res.headersSent) {
            res.json({ success: false, error: err.message });
        }
    }
});

// Stop Bot
app.post('/api/bot/stop', (req, res) => {
    try {
        if (botProcess) {
            botProcess.kill();
            botProcess = null;
        }

        const uptime = botState.startTime ? Math.floor((Date.now() - botState.startTime) / 1000) : 0;
        botState.running = false;
        botState.whatsappConnected = false;
        botState.qrCode = null;
        botState.pid = null;

        logEvent(`Bot stopped via dashboard. Uptime: ${uptime}s, Messages: ${botState.messageCount}`, 'info');

        res.json({
            success: true,
            message: 'Bot stopped',
            uptime: uptime,
            messageCount: botState.messageCount
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Logout Bot (Disconnect Session)
app.post('/api/bot/logout', (req, res) => {
    try {
        if (botProcess) {
            botProcess.send({ type: 'logout' });
        } else {
            // If process isn't running, still try to clean up auth folder if it exists
            const authPath = path.join(__dirname, '../.wwebjs_auth');
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
            }
        }

        const uptime = botState.startTime ? Math.floor((Date.now() - botState.startTime) / 1000) : 0;
        botState.running = false;
        botState.whatsappConnected = false;
        botState.qrCode = null;
        botState.pid = null;

        logEvent(`Bot logged out and session cleared. Uptime: ${uptime}s`, 'warning');

        res.json({
            success: true,
            message: 'Bot logged out and session disconnected',
            uptime: uptime
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Set QR Code (called by main bot process)
app.post('/api/bot/set-qr', (req, res) => {
    const { qr } = req.body;
    botState.qrCode = qr;
    botState.lastQRTime = Date.now();
    logEvent('QR code generated', 'info');
    res.json({ success: true });
});

// Set WhatsApp Connected (called by main bot process)
app.post('/api/bot/set-connected', (req, res) => {
    botState.running = true; // Ensure it's marked running
    botState.whatsappConnected = true;
    logEvent('WhatsApp connected successfully', 'success');
    res.json({ success: true });
});

// Log event from bot process
app.post('/api/bot/log-event', (req, res) => {
    const { message, type, category } = req.body;
    logEvent(message, type || 'info', category || 'events');
    res.json({ success: true });
});

// Get AI Rules
app.get('/api/bot/rules', (req, res) => {
    try {
        const rulesPath = path.join(__dirname, '../config/rules.json');
        if (fs.existsSync(rulesPath)) {
            const data = fs.readFileSync(rulesPath, 'utf8');
            return res.json(JSON.parse(data));
        }
        res.json({ rules: [], defaultReply: "" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save AI Rules
app.post('/api/bot/rules', (req, res) => {
    try {
        const rulesPath = path.join(__dirname, '../config/rules.json');
        fs.writeFileSync(rulesPath, JSON.stringify(req.body, null, 2));
        logEvent('AI Rules updated', 'success');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Increment Message Count (called by main bot process)
app.post('/api/bot/message-received', (req, res) => {
    const { from } = req.body;
    botState.messageCount++;

    // Track unique users
    if (from) {
        if (!Array.isArray(botState.activeUsers)) botState.activeUsers = [];
        if (!botState.activeUsers.includes(from)) {
            botState.activeUsers.push(from);
            if (botState.activeUsers.length > 1000) {
                botState.activeUsers.shift();
            }
        }
    }

    res.json({ success: true });
});

// Refresh QR Code
app.post('/api/bot/qr-refresh', (req, res) => {
    if (!botState.running) {
        return res.json({ success: false, error: 'Bot is not running' });
    }

    botState.qrCode = null;
    botState.whatsappConnected = false;

    res.json({
        success: true,
        message: 'QR code reset, new one will be generated'
    });
});

// Check Unread Messages Manually
app.post('/api/bot/check-unread', (req, res) => {
    if (!botState.running || !botProcess) {
        return res.json({ success: false, error: 'Bot is not running' });
    }

    botProcess.send({ type: 'check-unread' });

    logEvent('Manual unread message check requested', 'info');
    res.json({ success: true, message: 'Checking for unread messages...' });
});

// Add Task
app.post('/api/tasks/add', (req, res) => {
    const task = req.body;
    botState.tasks = botState.tasks || [];
    botState.tasks.push(task);
    saveConfig();

    logEvent(`Task added: ${task.type} at ${task.time}`, 'info');

    res.json({ success: true, message: 'Task added', taskId: task.id });
});

// Delete Task
app.post('/api/tasks/delete', (req, res) => {
    const { id } = req.body;
    botState.tasks = (botState.tasks || []).filter(t => t.id !== id);
    saveConfig();

    logEvent(`Task deleted: ${id}`, 'info');

    res.json({ success: true, message: 'Task deleted' });
});

// Get All Tasks
app.get('/api/tasks', (req, res) => {
    res.json({ tasks: botState.tasks || [] });
});

// Logging utility
function logEvent(message, type = 'info', category = 'events') {
    const logDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logsFile = path.join(logDir, `${category}.log`);
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;

    fs.appendFileSync(logsFile, logEntry);

    // Also update JSON logs for frontend polling
    if (['intent', 'tool', 'error'].includes(category)) {
        const jsonFile = path.join(__dirname, `../data/${category}s.json`);
        let logs = [];
        try {
            if (fs.existsSync(jsonFile)) {
                logs = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
            }
        } catch (e) {
            logs = [];
        }

        logs.unshift({ timestamp, type, message });
        if (logs.length > 50) logs = logs.slice(0, 50); // Keep last 50

        if (!fs.existsSync(path.dirname(jsonFile))) {
            fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
        }
        fs.writeFileSync(jsonFile, JSON.stringify(logs, null, 2));
    }
}

// Log Event from Bot
app.post('/api/bot/log-event', (req, res) => {
    try {
        const { message, type, category } = req.body;
        if (!message) return res.status(400).json({ error: 'Message required' });

        logEvent(message, type || 'info', category || 'events');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start Outreach
app.post('/api/bot/outreach', async (req, res) => {
    try {
        const { numbers } = req.body;
        if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
            return res.status(400).json({ error: 'Invalid numbers list' });
        }

        if (!botState.whatsappConnected) {
            return res.status(503).json({ error: 'WhatsApp not connected' });
        }

        // Reset and start outreach
        botState.outreach = {
            total: numbers.length,
            success: 0,
            failed: 0,
            running: true
        };

        // Add to command queue instead of relying on IPC
        botState.commandQueue.push({ type: 'start-outreach', numbers });

        res.json({ success: true, message: `Started outreach to ${numbers.length} potential clients.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Outreach Status
app.get('/api/bot/outreach/status', (req, res) => {
    res.json(botState.outreach);
});

// Broadcast Message to All Users
app.post('/api/bot/broadcast', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }

        if (!botState.whatsappConnected) {
            return res.status(503).json({ error: 'WhatsApp not connected' });
        }

        // Add to command queue
        botState.commandQueue.push({ type: 'broadcast', message });

        res.json({ success: true, message: 'Broadcast message queued', count: 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send Test Message to Single User
app.post('/api/bot/test-message', async (req, res) => {
    try {
        const { phone, message } = req.body;
        if (!phone || !message) {
            return res.status(400).json({ error: 'Phone and message required' });
        }

        if (!botState.running || !botProcess) {
            return res.status(503).json({ error: 'Bot not running' });
        }

        // Send IPC message to child process
        botProcess.send({ type: 'send-test-message', phone, message });

        res.json({ success: true, message: 'Test message sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bot Command Polling Endpoint
app.get('/api/bot/commands/poll', (req, res) => {
    const commands = [...botState.commandQueue];
    botState.commandQueue = []; // Clear queue after polling
    res.json({ commands });
});

// Get Live Analytics
app.get('/api/bot/analytics', async (req, res) => {
    try {
        if (botState.running && botProcess) {
            // Request analytics export
            botProcess.send({ type: 'get-analytics' });
            // Wait a bit for file to be written
            await new Promise(r => setTimeout(r, 300));
        }

        const analyticsFile = path.join(__dirname, '../data/analytics-live.json');
        if (fs.existsSync(analyticsFile)) {
            const data = fs.readFileSync(analyticsFile, 'utf8');
            const parsed = JSON.parse(data);

            // Sync message count with botState if it's lagging
            if (parsed.messageCount > botState.messageCount) {
                botState.messageCount = parsed.messageCount;
            }

            res.json({
                ...parsed,
                status: botState.running ? 'Online' : 'Offline'
            });
        } else {
            res.json({ totalUsers: 0, messageCount: 0, conversations: [], status: 'Offline' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Logs
app.get('/api/bot/logs', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const logsDir = path.join(__dirname, '../logs');

        if (!fs.existsSync(logsDir)) {
            return res.json({ logs: [] });
        }

        const files = fs.readdirSync(logsDir).slice(-10); // Last 10 files
        const logs = files.map(f => ({
            name: f,
            path: f,
            size: fs.statSync(path.join(logsDir, f)).size
        }));

        res.json({ logs });
    } catch (error) {
        res.json({ logs: [], error: error.message });
    }
});

// Clear Cache
app.post('/api/bot/cache/clear', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');

        // Clear in-memory cache
        botState.messageCache = {};

        res.json({ success: true, message: 'Cache cleared successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Download Backup
app.get('/api/bot/backup', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const backupData = {
            timestamp: new Date().toISOString(),
            config: require('../config/bot-config.json'),
            learningData: require('../data/selfLearningData.json'),
            analytics: require('../data/analytics-live.json')
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="bot-backup-${timestamp}.json"`);
        res.send(JSON.stringify(backupData, null, 2));
    } catch (error) {
        res.status(500).json({ error: 'Backup failed: ' + error.message });
    }
});

// Get System Info
app.get('/api/bot/system-info', async (req, res) => {
    try {
        const os = require('os');
        const fs = require('fs');
        const path = require('path');

        const configPath = path.join(__dirname, '../config/bot-config.json');
        const config = fs.existsSync(configPath) ? require(configPath) : {};

        res.json({
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            totalMemory: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            freeMemory: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            uptime: (os.uptime() / 3600).toFixed(2) + ' hours',
            nodeVersion: process.version,
            botConfig: {
                personality: config.personality || 'professional',
                useWebSearch: config.useWebSearch || false,
                enableLearning: config.enableLearning || true
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Intent Distribution
app.get('/api/bot/intents', async (req, res) => {
    try {
        const jsonFile = path.join(__dirname, '../data/intents.json');
        if (fs.existsSync(jsonFile)) {
            const data = fs.readFileSync(jsonFile, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json([]);
        }
    } catch (error) {
        res.json({ error: error.message });
    }
});

// Get Tool Calls
app.get('/api/bot/tool-calls', async (req, res) => {
    try {
        const jsonFile = path.join(__dirname, '../data/tools.json');
        if (fs.existsSync(jsonFile)) {
            const data = fs.readFileSync(jsonFile, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json([]);
        }
    } catch (error) {
        res.json({ error: error.message });
    }
});

// Get Errors
app.get('/api/bot/errors', async (req, res) => {
    try {
        const jsonFile = path.join(__dirname, '../data/errors.json');
        if (fs.existsSync(jsonFile)) {
            const data = fs.readFileSync(jsonFile, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json([]);
        }
    } catch (error) {
        res.json({ error: error.message });
    }
});

// Get Learning Data
app.get('/api/bot/learning', async (req, res) => {
    try {
        const jsonFile = path.join(__dirname, '../data/selfLearningData.json');
        if (fs.existsSync(jsonFile)) {
            const data = fs.readFileSync(jsonFile, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json([]);
        }
    } catch (error) {
        res.json({ error: error.message });
    }
});

// Get Personality Stats
app.get('/api/bot/personality', async (req, res) => {
    try {
        const jsonFile = path.join(__dirname, '../data/personality-live.json');
        if (fs.existsSync(jsonFile)) {
            const data = fs.readFileSync(jsonFile, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json({
                traits: { witty: 50, logical: 50, ethical: 50, empathetic: 50, creative: 50 },
                currentVibe: "Bot is offline. I'm resting my circuits."
            });
        }
    } catch (error) {
        res.json({ error: error.message });
    }
});

// Get User Profiles
app.get('/api/bot/profiles', async (req, res) => {
    try {
        const jsonFile = path.join(__dirname, '../data/profiles-live.json');
        if (fs.existsSync(jsonFile)) {
            const data = fs.readFileSync(jsonFile, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json({ success: true, profiles: {} });
        }
    } catch (error) {
        res.json({ error: error.message });
    }
});

// Get Business Reports
app.get('/api/bot/reports', async (req, res) => {
    try {
        const jsonFile = path.join(__dirname, '../data/reports.json');
        if (fs.existsSync(jsonFile)) {
            const data = fs.readFileSync(jsonFile, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json([]);
        }
    } catch (error) {
        res.json({ error: error.message });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎛️  Control Panel Server Running!`);
    console.log(`📱 Open: http://localhost:${PORT}`);
    console.log(`${'='.repeat(50)}\n`);

    loadConfig();
    logEvent('Control panel server started', 'info');
});

module.exports = app;
