
// DOM Elements
const elements = {
    statusIndicator: document.getElementById('statusIndicator'),
    statusText: document.getElementById('statusText'),
    whatsappStatus: document.getElementById('whatsappStatus'),
    uptime: document.getElementById('uptime'),
    messageCount: document.getElementById('messageCount'),
    messageCountMini: document.getElementById('messageCountMini'),
    totalUsers: document.getElementById('totalUsers'),
    usersCountMini: document.getElementById('usersCountMini'),
    successRate: document.getElementById('successRate'),
    avgResponse: document.getElementById('avgResponse'),
    cpuBar: document.getElementById('cpuBar'),
    memoryBar: document.getElementById('memoryBar'),
    qrContainer: document.getElementById('qrContainer'),
};

// State
let isConnected = false;
let startTime = Date.now();

// Init
document.addEventListener('DOMContentLoaded', () => {
    refreshStats();
    setInterval(refreshStats, 2000); // Poll every 2s for real-time updates
    switchTab('analytics');
});

// Tab Switching
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    document.getElementById(`tab-${tabName}`).style.display = 'block';
    document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add('active');
}

// Bot Control
async function startBot() {
    updateStatus('Starting...', 'orange');
    try {
        await fetch('/api/bot/start', { method: 'POST' });
        setTimeout(refreshStats, 2000);
    } catch (e) {
        console.error(e);
        updateStatus('Error starting', 'red');
    }
}

async function stopBot() {
    updateStatus('Stopping...', 'red');
    try {
        await fetch('/api/bot/stop', { method: 'POST' });
        isConnected = false;
        refreshStats();
    } catch (e) {
        console.error(e);
    }
}

async function logoutBot() {
    if (!confirm('Are you sure you want to logout? You will need to rescan QR.')) return;
    try {
        await fetch('/api/bot/logout', { method: 'POST' });
        location.reload();
    } catch (e) {
        console.error(e);
    }
}

// Data Handling
async function refreshStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        updateUI(data);
    } catch (e) {
        console.warn('Backend not reachable');
        updateStatus('Offline', '#555');
    }
}

function updateUI(data) {
    if (data.status === 'connected') {
        updateStatus('Online', '#39ff14');
        elements.whatsappStatus.innerText = 'Connected';
        elements.whatsappStatus.style.color = '#39ff14';
        isConnected = true;
        elements.qrContainer.innerHTML = '<p class="info-text">✅ Bot is connected</p>';
    } else if (data.status === 'waiting_qr') {
        updateStatus('Waiting for QR', 'orange');
        elements.whatsappStatus.innerText = 'Scan QR';
        elements.whatsappStatus.style.color = 'orange';
        isConnected = false;
    } else {
        updateStatus('Stopped', 'red');
        elements.whatsappStatus.innerText = 'Offline';
        elements.whatsappStatus.style.color = '#ff4444';
        isConnected = false;
        elements.qrContainer.innerHTML = '<p class="info-text">❌ Bot is stopped</p>';
    }

    elements.uptime.innerText = formatUptime(data.uptime);
    elements.messageCount.innerText = data.messages || 0;
    elements.messageCountMini.innerText = data.messages || 0;
    elements.totalUsers.innerText = data.users || 0;
    elements.usersCountMini.innerText = data.users || 0;

    // System Health
    elements.cpuBar.style.width = (data.cpu || 10) + '%';
    elements.memoryBar.style.width = (data.memory || 20) + '%';
}

function updateStatus(text, color) {
    elements.statusText.innerText = text;
    elements.statusIndicator.style.background = color;
    elements.statusIndicator.style.boxShadow = `0 0 8px ${color}`;
}

// Helpers
function formatUptime(seconds) {
    if (!seconds) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

// Outreach (Sales)
async function startOutreach() {
    const numbers = document.getElementById('outreachNumbers').value;
    if (!numbers) return alert('Please enter numbers!');

    document.getElementById('outreachStatus').innerText = '🚀 Launching campaign...';

    try {
        // Send to backend
        const res = await fetch('/api/bot/outreach', { // Fixed endpoint
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                numbers: numbers.split('\n').filter(n => n.trim()) // simplified body
            })
        });
        document.getElementById('outreachStatus').innerText = '✅ Campaign started in background.';
    } catch (e) {
        document.getElementById('outreachStatus').innerText = '❌ Failed to start.';
    }
}

// Poll for QR Code updates (naive implementation)
setInterval(async () => {
    if (isConnected) return;
    try {
        const res = await fetch('/api/bot/qr');
        const data = await res.json();
        if (data.qr) {
            elements.qrContainer.innerHTML = `<img src="data:image/png;base64,${data.qr}" style="width: 200px; border-radius: 8px;">`;
        }
    } catch (e) { }
}, 2000);

// --- CHARTS IMPLEMENTATION ---
let msgChartInstance = null;
let intentChartInstance = null;

function initCharts() {
    const ctxMsg = document.getElementById('messagesChart');
    const ctxIntent = document.getElementById('intentsChart');

    if (ctxMsg) {
        msgChartInstance = new Chart(ctxMsg, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Messages',
                    data: [],
                    borderColor: '#39ff14',
                    backgroundColor: 'rgba(57, 255, 20, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } }
                }
            }
        });
    }

    if (ctxIntent) {
        intentChartInstance = new Chart(ctxIntent, {
            type: 'doughnut',
            data: {
                labels: ['Sales', 'Support', 'General', 'Unknown'],
                datasets: [{
                    data: [0, 0, 0, 0],
                    backgroundColor: [
                        '#39ff14', // Green
                        '#00d4ff', // Blue
                        '#ff00ff', // Pink
                        '#555555'  // Grey
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'right', labels: { color: '#ccc' } } },
                cutout: '70%'
            }
        });
    }
}

// Function to fetch and update charts
async function updateCharts() {
    if (!msgChartInstance || !intentChartInstance) return;

    try {
        // Fetch Analytics (Mocking timeline for now as API might not return timeseries)
        // In a real app, /api/bot/analytics would return timeseries data
        const res = await fetch('/api/bot/analytics');
        const data = await res.json();

        // Update Messages Chart (Simulated history for demo)
        // Use real message count to push new point
        const now = new Date().toLocaleTimeString();

        if (msgChartInstance.data.labels.length > 10) {
            msgChartInstance.data.labels.shift();
            msgChartInstance.data.datasets[0].data.shift();
        }

        // Push Real Data Only
        msgChartInstance.data.labels.push(now);
        msgChartInstance.data.datasets[0].data.push(data.messageCount || 0);
        msgChartInstance.update('none');

        // Update Intents Chart
        if (data.intents) {
            // Map backend intents data to chart if available, else default to 0 or waiting
            const intentData = [
                data.intents.sales || 0,
                data.intents.support || 0,
                data.intents.general || 0,
                data.intents.unknown || 0
            ];

            // Only update if we have data to show, otherwise keep empty
            if (intentData.reduce((a, b) => a + b, 0) > 0) {
                intentChartInstance.data.datasets[0].data = intentData;
                intentChartInstance.update();
            }
        }

    } catch (e) { }
}

// Initial Call
initCharts();
setInterval(updateCharts, 5000); // Update charts every 5s
