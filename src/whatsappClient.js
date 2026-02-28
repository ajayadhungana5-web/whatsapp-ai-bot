const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const AIProvider = require('./aiProvider');
const config = require('../config/config');

// Determine Chromium/Chrome path based on environment
function getChromePath() {
  // Allow override via environment variable
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  // On Windows (local dev), use standard Chrome location
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  // On Linux (Render), strictly point to the installed cache directory.
  // We use string manipulation to find the exact binary path since Puppeteer's internal resolution fails on Render.
  try {
    const puppeteer = require('puppeteer');
    const path = require('path');

    // Attempt standard resolution first
    const execPath = puppeteer.executablePath();
    if (execPath && require('fs').existsSync(execPath)) {
      return execPath;
    }

    // Explicit fallback to Render's known cache location
    const renderCachePath = '/opt/render/project/src/.cache/puppeteer';
    const fs = require('fs');

    // Puppeteer installs into .cache/puppeteer/chrome/<os>-<version>/chrome-linux64/chrome
    // We need to find the actual executable
    if (fs.existsSync(renderCachePath)) {
      return puppeteer.executablePath(); // It should find it now that we forced it here
    }
  } catch (error) {
    console.warn("Path resolution error:", error.message);
  }

  // Final hail-mary for Render: explicitly return the exact path the error message says it's missing from
  return '/opt/render/project/src/.cache/puppeteer/chrome/linux-145.0.7632.26/chrome-linux64/chrome';
}

class WhatsAppBot {
  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',

          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-web-security',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled',
          '--ignore-certificate-errors'
        ],
        // Force the absolute path 
        executablePath: getChromePath(),
      },
      // webVersionCache: {
      //   type: 'remote',
      //   remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2407.3.html',
      // },
      authTimeoutMs: 60000,
    });

    this.aiProvider = new AIProvider();

    // Initialize Executor Mode (Strongest God Mode)
    // Initialize Executor Mode (Strongest God Mode)
    const GodModeExecutor = require('./godModeExecutor');
    this.godModeExecutor = new GodModeExecutor(this.aiProvider, this);

    // Track executor mode per user (for structured instruction execution)
    this.executorModeStates = new Map(); // phoneNumber -> isActive
    // Track Owner Mode state per user (for admin testing as boss/client)
    this.ownerModeStates = new Map();

    // DEDUP: Track processed message IDs to prevent duplicate replies
    this.processedMsgIds = new Set();

    console.log('[GodModeExecutor] ⚡ Instruction Executor System (GOD MODE) Initialized');

    this.setupEventHandlers();
    this.qrCodeReceived = false;
  }
  setupEventHandlers() {
    this.client.on('qr', (qr) => {
      console.log('\n📱 WhatsApp QR Code generated:');
      qrcode.generate(qr, { small: true });
      console.log('👉 Scan the QR code above\n');
      this.sendQRToControlPanel(qr);
    });

    this.client.on('ready', async () => {
      console.log('\n✅ Bot is READY! WhatsApp connected successfully.');
      this.notifyControlPanelConnected();
      this.startCommandPolling();

      // 1. Immediate check for missed messages while offline
      console.log('📥 Checking for unread messages causing backlog...');
      await this.checkUnreadMessages();

      // 2. Set up periodic check (every 60s) to ensure nothing is missed
      setInterval(async () => {
        await this.checkUnreadMessages();
      }, 60000);

      // 3. DEBUG: Active Call Polling (DIAGNOSTIC MODE)
      setInterval(async () => {
        try {
          const debugInfo = await this.client.pupPage.evaluate(() => {
            const debug = {};
            if (!window.Store) return { error: 'No Store' };

            // 1. Check for standard Call Store
            const callStore = window.Store.Call || window.Store.WAWebCallCollection;
            debug.hasCallStore = !!callStore;
            if (callStore) {
              debug.models = callStore.models ? callStore.models.length : 'no-models';
              if (callStore.models && callStore.models.length > 0) {
                debug.calls = callStore.models.map(c => ({
                  id: c.id,
                  peer: c.peerJid,
                  state: c.state,
                  isGroup: c.isGroup
                }));
              }
            }

            // 2. Search for ANY key resembling "Call" in Store
            debug.potentialStores = Object.keys(window.Store).filter(k => k.toLowerCase().includes('call'));

            return debug;
          });

          // Only log if we found something interesting (active calls or potential keys)
          if (debugInfo.hasCallStore && debugInfo.models > 0) {
            console.log('[DEBUG] FOUND ACTIVE CALLS:', JSON.stringify(debugInfo.calls));

            // Attempt Rejection
            await this.client.pupPage.evaluate(() => {
              const callStore = window.Store.Call || window.Store.WAWebCallCollection;
              callStore.models.forEach(c => {
                if (!c.state || c.state === 'INCOMING' || c.state === 'RINGING') {
                  // Try injection reject
                  if (window.WWebJS && window.WWebJS.rejectCall) {
                    window.WWebJS.rejectCall(c.peerJid, c.id);
                  } else {
                    // Try direct model reject if available
                    if (c.reject) c.reject();
                  }
                }
              });
            });
          } else if (debugInfo.hasCallStore === false) {
            console.log('[DEBUG] Call Store MISSING. Potential keys:', debugInfo.potentialStores);
          }

        } catch (e) {
          // console.error('[DEBUG LOOP ERROR]', e.message); 
        }
      }, 2000); // Check every 2 seconds for calls

      console.log('💬 Now listening for INCOMING messages (and polling validation every 60s)...\n');
    });

    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp AUTHENTICATED! Session saved.');
    });

    this.client.on('message', async (msg) => {
      console.log(`\n✉️  New Message from ${msg.from}: "${msg.body}"`);
      await this.handleMessage(msg);
      this.exportAnalytics().catch(() => { });
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failed:', msg);
    });

    this.client.on('disconnected', (reason) => {
      console.log('⚠️  WhatsApp disconnected:', reason);
    });

    this.client.on('incoming_call', async (call) => {
      console.log(`📞 Incoming call from ${call.from}`);
      try {
        await call.reject();
        console.log('📞 Call rejected automatically.');
        await this.client.sendMessage(call.from, "📞 I'm an AI assistant and cannot answer live calls yet.\n\n🎙️ Please send me a **Voice Note** and I will listen and reply with audio!");
      } catch (e) {
        console.error('Error handling incoming call:', e.message);
      }
    });
  }

  sendQRToControlPanel(qr) {
    const QRCode = require('qrcode');
    QRCode.toDataURL(qr, { errorCorrectionLevel: 'H', type: 'image/png' }, (err, url) => {
      if (!err && url) {
        const base64 = url.split(',')[1];
        fetch('http://localhost:3001/api/bot/set-qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qr: base64 })
        }).catch(() => { });
      }
    });
  }

  notifyControlPanelConnected() {
    fetch('http://localhost:3001/api/bot/set-connected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).catch(() => { });
  }

  /**
   * Safe reply method with retry logic and detached frame error handling
   * @param {Message} msg - The WhatsApp message to reply to
   * @param {string} text - The text to send
   * @param {number} retries - Number of retry attempts
   * @returns {Promise<boolean>} - True if sent successfully, false otherwise
   */
  async safeReply(msg, text, retries = 3) {
    let lastError = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Check if client is still connected
        if (!this.client || !this.client.info) {
          console.warn(`[SafeReply] ⚠️ Client not connected (attempt ${attempt + 1}/${retries})`);
          if (attempt < retries - 1) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
            continue;
          }
          return false;
        }

        // Try to send the reply
        await msg.reply(text);
        console.log(`[SafeReply] ✅ Message sent successfully`);
        return true;

      } catch (error) {
        lastError = error;
        const errorMsg = error.message || String(error);

        // Check for detached frame or connection errors
        if (errorMsg.includes('detached Frame') ||
          errorMsg.includes('Target closed') ||
          errorMsg.includes('session closed') ||
          errorMsg.includes('Connection closed')) {

          console.warn(`[SafeReply] ⚠️ Connection error: ${errorMsg} (attempt ${attempt + 1}/${retries})`);

          // Don't retry if this was the last attempt
          if (attempt < retries - 1) {
            const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s...
            console.log(`[SafeReply] ⏳ Waiting ${backoffMs}ms before retry...`);
            await new Promise(r => setTimeout(r, backoffMs));
            continue;
          }
        } else {
          // For non-connection errors, log and fail immediately
          console.error(`[SafeReply] ❌ Unexpected error: ${errorMsg}`);
          return false;
        }
      }
    }

    // All retries failed
    console.error(`[SafeReply] ❌ Failed after ${retries} attempts. Last error:`, lastError?.message);
    return false;
  }

  async handleMessage(msg) {
    try {
      console.log(`[DEBUG] handleMessage START - From: ${msg.from}, Body: "${msg.body}", fromMe: ${msg.fromMe}, author: ${msg.author}`);

      // DEDUP: Skip if we already processed this exact message
      const msgId = msg.id && msg.id._serialized ? msg.id._serialized : `${msg.from}_${msg.timestamp}`;

      if (this.processedMsgIds.has(msgId)) {
        console.log(`[DEDUP] 🛑 Skipping already-processed message: ${msgId}`);
        return;
      }

      this.processedMsgIds.add(msgId);
      console.log(`[MSG_ID] Processing NEW message: ${msgId}`);

      // Auto-cleanup: keep only last 500 IDs to prevent memory leak
      if (this.processedMsgIds.size > 500) {
        const first = this.processedMsgIds.values().next().value;
        this.processedMsgIds.delete(first);
      }

      // Ignore messages sent BY the bot (prevent responding to own messages)
      if (msg.fromMe || !msg.from || msg.from === undefined) {
        // console.log(`[DEBUG] Ignoring message sent by bot (fromMe=${msg.fromMe})`);
        return;
      }

      // Additional check: if message has no valid sender, skip it
      if (typeof msg.from !== 'string' || msg.from.trim() === '') {
        console.log(`[MSG_FILTER] Skipping message with invalid sender`);
        return;
      }

      // Ignore group messages and broadcast lists
      if (msg.isGroupMsg || msg.from.includes('@g.us') || msg.from === 'status@broadcast') {
        console.log(`[MSG_FILTER] Skipping group/broadcast message from ${msg.from}`);
        return;
      }

      // Handle Media - Return friendly message instead of AI processing
      if (msg.hasMedia) {
        console.log(`[DEBUG] Message contains media type: ${msg.type}`);

        // VOICE MODE: Handle Voice Notes (ptt) or Audio
        if (msg.type === 'ptt' || msg.type === 'audio') {
          try {
            const contact = await msg.getContact();
            const senderName = contact.pushname || contact.name || "Friend";
            const isOwnerMode = this.ownerModeStates.get(msg.from) || false;

            console.log(`[VoiceMode] 🎙️ Processing Voice Note from ${senderName}...`);

            // 1. Download Audio
            const media = await msg.downloadMedia();
            if (!media) throw new Error('Failed to download media');

            // 2. Transcribe Locally (Offline/Free)
            const TranscriptionProvider = require('./transcriptionProvider');
            if (!this.transcriptionProvider) this.transcriptionProvider = new TranscriptionProvider();

            // Convert base64 to Buffer
            const audioBuffer = Buffer.from(media.data, 'base64');
            const transcribedText = await this.transcriptionProvider.transcribe(audioBuffer);

            console.log(`[VoiceMode] 🗣️ User Said: "${transcribedText}"`);

            if (!transcribedText || transcribedText.trim().length === 0) {
              await this.safeReply(msg, "I couldn't hear anything. Please try again.");
              return;
            }

            // 3. Process with AI (Text-Only Mode now since we have text)
            // This allows us to use OpenRouter/ChatGPT even if Gemini Voice is dead
            // BUT we pass a flag to aiProvider to use the "Voice System Prompt"
            const aiResponseText = await this.aiProvider.getResponse(
              transcribedText,
              msg.from,
              senderName,
              isOwnerMode,
              true // isVoiceMode = true
            );

            console.log(`[VoiceMode] 🤖 AI Response: "${aiResponseText}"`);

            // 4. Generate Audio Reply (TTS) - reuse cached instance
            const TTSProvider = require('./ttsProvider');
            if (!this.ttsProvider) this.ttsProvider = new TTSProvider();
            let audioBase64 = await this.ttsProvider.generateAudio(aiResponseText);

            if (audioBase64) {
              // Try converting to OGG for better WhatsApp PTT compatibility
              const oggBase64 = await this.ttsProvider.convertToOgg(audioBase64);
              let finalAudio = oggBase64 || audioBase64;
              let mimeType = oggBase64 ? 'audio/ogg; codecs=opus' : 'audio/mp3';

              const { MessageMedia } = require('whatsapp-web.js');
              const audioMedia = new MessageMedia(mimeType, finalAudio, 'reply.ogg');
              await this.client.sendMessage(msg.from, audioMedia, { sendAudioAsVoice: true });
              console.log(`[VoiceMode] 📤 Sent Audio Reply`);
            } else {
              // Fallback to text if TTS failed
              await this.safeReply(msg, `🗣️ *AI:* ${aiResponseText}`);
            }

            return; // Done handling voice
          } catch (err) {
            console.error('[VoiceMode] Error:', err.message);
            await this.safeReply(msg, "Sorry, I had trouble listening to your audio. 🙉");
            return;
          }
        }

        // For other media (Images/Video), just friendly reply for now
        if (!msg.body) {
          await this.safeReply(msg, "I see you sent a photo/file! 📸\nI can't view images yet, but I can answer any text questions about Karta!");
          return;
        }
      }

      // Notify control panel of new message received
      if (process.send) {
        process.send({ type: 'message-received', from: msg.from, body: msg.body });
      }

      // Also use API for independence
      fetch('http://localhost:3001/api/bot/message-received', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: msg.from })
      }).catch(() => { });

      // Get AI response
      console.log(`[AI] Generating response...`);
      const contact = await msg.getContact();
      const senderName = contact.pushname || contact.name || "friend";
      const message = msg.body;

      // 0. God Mode Check (Direct Execution for Admin)
      const adminNumber = '9779804265296';

      // Allow Owner Mode Toggle for Admin
      if (msg.from.includes(adminNumber)) {
        const msgLower = message.toLowerCase().trim();

        if (msgLower === 'owner mode on') {
          this.ownerModeStates.set(msg.from, true);
          await this.safeReply(msg, '🫡 **Owner Mode ACTIVATED**.\nI will now treat you as my creator. Commands are enabled.');
          return;
        }
        if (msgLower === 'owner mode off') {
          this.ownerModeStates.delete(msg.from);
          await this.safeReply(msg, '💼 **Owner Mode DEACTIVATED**.\nI will now treat you as a customer (Sales Mode). Testing enabled.');
          return;
        }
      }

      if (msg.from.includes(adminNumber)) {
        const msgLower = message.toLowerCase().trim();

        // Check for GOD MODE activation (Structured Instruction Execution)
        if (msgLower.includes('god mode start') || msgLower === 'god mode on' || msgLower.includes('executor mode start') || msgLower === 'executor mode on') {
          console.log(`[GodModeExecutor] ⚡ GOD MODE activation request from ${msg.from}`);
          const chat = await msg.getChat();
          await chat.sendStateTyping();

          try {
            this.executorModeStates.set(msg.from, true);
            const initMessage = `🤖 *GOD MODE ACTIVATED*\n\n` +
              `I can now understand and execute ANY instruction you give me:\n\n` +
              `📝 *Code Generation:* "Create a Python script that..."\n` +
              `📡 *API Calls:* "Call OpenRouter API to..."\n` +
              `🖥️ *System Commands:* "Run these terminal commands..."\n` +
              `📊 *Data Processing:* "Process this CSV file by..."\n` +
              `🔗 *Workflows:* "Execute these steps in sequence..."\n\n` +
              `Every instruction → Parsed Intent → Machine-Actionable Output → Ready to Execute\n\n` +
              `Send any instruction now!`;

            await this.safeReply(msg, initMessage);
            console.log(`[GodModeExecutor] ✅ GOD MODE activated for ${msg.from}`);
            return;
          } catch (error) {
            console.error(`[GodModeExecutor] ❌ Activation failed:`, error);
            await this.safeReply(msg, `⚠️ Failed to activate GOD MODE: ${error.message}`);
            return;
          }
        }

        // Check for GOD MODE deactivation
        if (msgLower.includes('god mode stop') || msgLower === 'god mode off' || msgLower.includes('executor mode stop') || msgLower === 'executor mode off') {
          console.log(`[GodModeExecutor] ⚡ GOD MODE deactivation request from ${msg.from}`);
          const chat = await msg.getChat();
          await chat.sendStateTyping();

          try {
            this.executorModeStates.delete(msg.from);
            const shutdownMessage = `⚡ GOD MODE Deactivated\n\nBack to normal mode.`;

            await this.safeReply(msg, shutdownMessage);
            console.log(`[GodModeExecutor] ✅ GOD MODE deactivated for ${msg.from}`);
            return;
          } catch (error) {
            console.error(`[GodModeExecutor] ❌ Deactivation failed:`, error);
            await this.safeReply(msg, `⚠️ Error deactivating GOD MODE: ${error.message}`);
            return;
          }
        }

        // Check if GOD MODE is active for this user
        const isGodModeActive = this.executorModeStates.get(msg.from);

        if (isGodModeActive) {
          // Route to GOD MODE - Parse AND Execute instruction automatically
          console.log(`[GodMode] 🚀 Full execution flow: "${message}"`);
          const chat = await msg.getChat();
          await chat.sendStateTyping();

          try {
            // Parse instruction → Execute automatically → Return result
            const executionResult = await this.godModeExecutor.executeInstruction(
              message,
              `WhatsApp from ${msg.from}`,
              msg.from
            );

            // Format result for WhatsApp and send
            const formattedMessage = this.godModeExecutor.formatForWhatsApp(executionResult);
            await this.safeReply(msg, formattedMessage);

            console.log(`[GodMode] ✨ Execution complete - status: ${executionResult.status}`);
            return;

          } catch (error) {
            console.error(`[GodMode] ❌ Error:`, error.message);
            await this.safeReply(msg, `⚠️ GOD MODE Error: ${error.message}`);
            return;
          }
        }
      }

      // Check Owner Mode state (Defaults to FALSE)
      const isOwnerMode = this.ownerModeStates.get(msg.from) || false;
      console.log(`[DEBUG] AI Request - Sender: ${msg.from}, OwnerMode: ${isOwnerMode}`);

      // Route to AI Provider directly
      const response = await this.aiProvider.getResponse(message, msg.from, senderName, isOwnerMode);

      let replyText = response;

      // Handle structured response if applicable (though getResponse currently returns string)
      if (typeof response === 'object' && response.text) {
        replyText = response.text;
      }

      console.log(`\n📤 Reply to ${msg.from}: "${replyText}"`);

      // 5. Simulate "typing" effect
      const chat = await msg.getChat();
      await chat.sendStateTyping();
      await this.safeReply(msg, replyText);
      console.log(`[SUCCESS] Replied to ${msg.from}`);

    } catch (error) {
      const errorMsg = error.message || String(error);
      console.error('[ERROR] handleMessage failed:', errorMsg);

      // Handle detached frame errors gracefully
      if (errorMsg.includes('detached Frame') || errorMsg.includes('Target closed') || errorMsg.includes('session closed')) {
        console.error('[CRITICAL] WhatsApp connection lost. This may require reconnection.');
        console.error('[CRITICAL] Error details:', error.stack);
        // Don't try to reply - the connection is broken
        return;
      }

      // For other errors, try to reply if possible
      try {
        await this.safeReply(msg, `⚠️ An error occurred while processing your message. Please try again in a moment.`);
      } catch (replyError) {
        console.error('[ERROR] Could not send error reply:', replyError.message);
      }
    }
  }

  async start() {
    try {
      console.log('🚀 Starting WhatsApp AI Bot...');
      console.log('⏳ Initializing WhatsApp Web (this may take a minute)...');

      // Initialize the client
      await this.client.initialize();

      console.log('✅ Client initialization call completed.');

      // Return a promise that resolves when the client is 'ready' 
      // or if it was already authenticated
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.log('⚠️  Startup notice: "Ready" event taking longer than expected...');
          resolve();
        }, 60000);

        this.client.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        if (this.client.info) {
          clearTimeout(timeout);
          resolve();
        }
      });
    } catch (error) {
      console.error('❌ Failed to initialize WhatsApp client:', error.message);
      throw error;
    }
  }

  // Force check for unread messages (can be called manually)
  async checkUnreadMessages() {
    console.log('📊 Manually checking for unread messages...');
    try {
      const chats = await this.client.getChats();
      let unreadTotal = 0;
      for (const chat of chats) {
        if (chat.unreadCount > 0) {
          unreadTotal += chat.unreadCount;
          const messages = await chat.fetchMessages({ limit: chat.unreadCount });
          for (const msg of messages) {
            await this.handleMessage(msg);
          }
          await chat.sendSeen().catch(() => { });
        }
      }
      if (unreadTotal > 0) {
        console.log(`✅ Processed ${unreadTotal} unread messages.`);
      } else {
        console.log('✅ No unread messages found.');
      }
    } catch (err) {
      console.error('Error during manual message check:', err.message);
    }
  }

  async startOutreach(numbers) {
    console.log(`🚀 Starting Voice+Text Outreach to ${numbers.length} potential clients...`);
    const results = { success: 0, failed: 0, details: [] };
    const delay = ms => new Promise(res => setTimeout(res, ms));

    if (!this.client || !this.client.info) {
      console.error('[Outreach] Client not ready');
      return { success: 0, failed: numbers.length, error: 'Client not authenticated' };
    }

    // 1. Prepare Content (Static Text & Audio)
    const textMessage = "Namaste! Mero naam Peggy ho. Hajur ko business ma kunai software use garnu vako cha ki chaina?";
    // Specific Script provided by user
    const voiceScript = "नमस्ते। कार्टा अकाउन्टिङ सफ्टवेयरबाट तपाईंले आफ्नो व्यवसाय मोबाइलबाटै सजिलै नियन्त्रण गर्न सक्नुहुन्छ। बिलिङ, स्टक व्यवस्थापन र उधारो हिसाब–किताब सबै एकै ठाउँमै हुन्छ। तपाईंको डाटा सुरक्षित रहन्छ, इन्टरनेट नहुँदा पनि काम रोकिँदैन। यदि तपाईंलाई सजिलो हिसाब–किताब चाहिएको हो भने, कार्टाबारे अलि विस्तारमा कुरा गरौँ?";

    let audioMedia = null;

    try {
      console.log(`[Outreach] 🎙️ Pre-generating Voice Pitch...`);
      const TTSProvider = require('./ttsProvider');
      if (!this.ttsProvider) this.ttsProvider = new TTSProvider();

      // Generate MP3
      const mp3Base64 = await this.ttsProvider.generateAudio(voiceScript);

      if (mp3Base64) {
        // Convert to OGG for PTT (Voice Note)
        const oggBase64 = await this.ttsProvider.convertToOgg(mp3Base64);
        const finalAudio = oggBase64 || mp3Base64;
        const mimeType = oggBase64 ? 'audio/ogg; codecs=opus' : 'audio/mp3';
        const { MessageMedia } = require('whatsapp-web.js');

        audioMedia = new MessageMedia(mimeType, finalAudio, 'outreach_pitch.ogg');
        console.log(`[Outreach] ✅ Audio Pitch Ready (${finalAudio.length} bytes)`);
      } else {
        console.error('[Outreach] ❌ Failed to generate audio. Will send text only.');
      }
    } catch (e) {
      console.error('[Outreach] ⚠️ Audio generation failed:', e.message);
    }

    // 2. Send Loop
    for (let i = 0; i < numbers.length; i++) {
      const number = numbers[i];
      try {
        let cleanNumber = number.replace(/\D/g, '');

        if (cleanNumber.length === 10 && cleanNumber.startsWith('9')) {
          cleanNumber = '977' + cleanNumber;
        }

        if (cleanNumber.length < 10) {
          results.details.push({ number, status: 'failed', reason: 'Invalid length' });
          results.failed++;
          continue;
        }

        const id = await this.client.getNumberId(cleanNumber);
        if (!id) {
          console.log(`[Outreach] ${cleanNumber} is not on WhatsApp.`);
          results.details.push({ number, status: 'failed', reason: 'Not on WhatsApp' });
          results.failed++;
          continue;
        }

        const chatId = id._serialized;

        // A. Send Text Question
        console.log(`[Outreach] 📤 Step 1: Sending Text to ${chatId}...`);
        await this.client.sendMessage(chatId, textMessage);

        // Wait 2 seconds for natural feel
        await delay(2000);

        // B. Send Voice Pitch (if available)
        if (audioMedia) {
          console.log(`[Outreach] 🎙️ Step 2: Sending Voice Note to ${chatId}...`);
          await this.client.sendMessage(chatId, audioMedia, { sendAudioAsVoice: true });
        }

        results.success++;
        results.details.push({ number, status: 'sent' });

        // Random delay between users (5-10s) to be safe
        const userDelay = Math.floor(Math.random() * 5000) + 5000;
        console.log(`[Outreach] ⏳ Waiting ${userDelay}ms before next user...`);
        await delay(userDelay);

      } catch (err) {
        console.error(`[Outreach] Failed to send to ${number}:`, err.message);
        results.failed++;
        results.details.push({ number, status: 'failed', reason: err.message });
      }
    }
    console.log(`✅ Outreach completed. Sent: ${results.success}, Failed: ${results.failed}`);
    return results;
  }

  async stop() {
    try {
      await this.client.destroy();
      console.log('✅ Bot stopped.');
    } catch (error) {
      console.error('Error stopping bot:', error);
    }
  }

  async exportAnalytics() {
    try {
      console.log('[Analytics] Exporting data...');
      const analytics = this.aiProvider.getAnalytics();
      const personality = this.aiProvider.getPersonality();
      const profiles = this.aiProvider.getProfiles();

      const fs = require('fs');
      const path = require('path');
      const dataDir = path.join(__dirname, '../data');

      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(path.join(dataDir, 'analytics-live.json'), JSON.stringify(analytics, null, 2));
      fs.writeFileSync(path.join(dataDir, 'personality-live.json'), JSON.stringify(personality, null, 2));
      fs.writeFileSync(path.join(dataDir, 'profiles-live.json'), JSON.stringify(profiles, null, 2));

      console.log('[Analytics] Data exported: analytics, personality, profiles');
    } catch (error) {
      console.error('[Analytics] Failed to export:', error.message);
    }
  }

  startCommandPolling() {
    console.log('📡 Starting command polling from Control Panel...');
    setInterval(async () => {
      try {
        const res = await fetch('http://localhost:3001/api/bot/commands/poll');
        const data = await res.json();

        if (data.commands && data.commands.length > 0) {
          for (const cmd of data.commands) {
            console.log(`[Command] Received: ${cmd.type}`);
            if (cmd.type === 'start-outreach') {
              this.startOutreach(cmd.numbers);
            } else if (cmd.type === 'broadcast') {
              this.broadcast(cmd.message);
            } else if (cmd.type === 'logout') {
              await this.logout();
              process.exit(0);
            }
          }
        }
      } catch (e) {
        // Server might be down
      }
    }, 5000); // Poll every 5s
  }

  async broadcast(text) {
    console.log(`📢 Broadcasting message to all active users...`);
    // Logic would go here to send to all users in memory
  }

  // Send message to a specific phone number (for self-learning notifications)
  async sendMessageToNumber(phoneNumber, messageText) {
    try {
      // Format phone number for WhatsApp
      let chatId = phoneNumber;
      if (!phoneNumber.includes('@')) {
        // If it's just a number, format it for WhatsApp
        chatId = phoneNumber.replace(/\D/g, '') + '@c.us';
      }

      console.log(`[SelfMessage] Sending to ${chatId}: "${messageText}"`);
      const result = await this.client.sendMessage(chatId, messageText);
      console.log(`[SelfMessage] ✅ Message sent successfully`);
      return result;
    } catch (error) {
      console.error(`[SelfMessage] ❌ Failed to send message to ${phoneNumber}:`, error.message);
    }
  }

  // Alias for multi-step executor
  async sendMessage(phoneNumber, messageText) {
    return await this.sendMessageToNumber(phoneNumber, messageText);
  }

  async logout() {
    try {
      if (this.client.info || this.client.pupBrowser) {
        console.log('🚪 Logging out from WhatsApp Web...');
        await this.client.logout();
      }
      console.log('✅ Logged out.');
    } catch (error) {
      console.error('Error logging out (might already be logged out):', error.message);
    }

    // Force cleanup
    await this.stop();

    // Delete session files to ensure next run asks for QR
    try {
      const fs = require('fs');
      const path = require('path');
      const authPath = path.join(__dirname, '../.wwebjs_auth');
      if (fs.existsSync(authPath)) {
        console.log('🗑️ Deleting session files...');
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log('✅ Session files deleted.');
      }
    } catch (err) {
      console.error('Error deleting session files:', err.message);
    }
  }
}

module.exports = WhatsAppBot;
