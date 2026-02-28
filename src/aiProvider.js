const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai'); // Required for OpenRouter
const Bytez = require('bytez.js'); // Required for Bytez
const config = require('../config/config');
const { getSystemPrompt, getVoiceSystemPrompt } = require('./kartaContext');
const ChatGPTBrowser = require('./chatgptBrowser');

class AIProvider {
  constructor() {
    // Configured keys
    this.keyManager = require('./keyManager');

    console.log(`[AIProvider] Initializing with ${this.keyManager.getStats().totalKeys} keys.`);

    // Initialize Bytez (Primary)
    if (config.ai.bytez && config.ai.bytez.apiKey) {
      this.bytezClient = new Bytez(config.ai.bytez.apiKey);
      console.log(`[AIProvider] Bytez Initialized (${config.ai.bytez.model})`);
    }

    // Initialize with the best working key
    this.initializeModel();

    // Initialize OpenRouter as fallback
    if (config.ai.openRouter && config.ai.openRouter.apiKey) {
      this.openRouter = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: config.ai.openRouter.apiKey,
        defaultHeaders: {
          "HTTP-Referer": "https://karta.io", // Optional
          "X-Title": "Karta AI", // Optional
        }
      });
      console.log(`[AIProvider] OpenRouter Initialized (${config.ai.openRouter.model})`);
    }

    // Initialize OpenRouter Backup
    if (config.ai.openRouterBackup && config.ai.openRouterBackup.apiKey) {
      this.openRouterBackup = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: config.ai.openRouterBackup.apiKey,
        defaultHeaders: {
          "HTTP-Referer": "https://karta.io", // Optional
          "X-Title": "Karta AI (Backup)", // Optional
        }
      });
      console.log(`[AIProvider] OpenRouter Backup Initialized (${config.ai.openRouterBackup.models ? config.ai.openRouterBackup.models.length + ' models' : config.ai.openRouterBackup.model})`);
    }

    // Initialize ChatGPT Browser Automation (Final Fallback)
    // No API key needed, uses Puppeteer
    this.chatGPTBrowser = new ChatGPTBrowser();
    console.log(`[AIProvider] ChatGPT Browser Automation Initialized`);

    // Simple in-memory history: Map<senderId, Array<{role: 'user'|'model', parts: string}>>
    this.history = new Map();

    // --- Sticky Provider Failover System ---
    // Provider order: bytez → openrouter → gemini → chatgpt
    // When a provider fails, it gets a cooldown and the next one becomes primary.
    this.providerCooldowns = {};  // { providerName: failedUntilTimestamp }
    this.COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes before retrying a failed provider
    this.currentPrimary = null; // Will be set on first getResponse call

    // Track which senders have already been greeted (to allow Namaste only on first message)
    this.greetedSenders = new Set();

    // Circuit Breaker for Gemini (Global Failover Persistence)
    this.geminiFailureCount = 0;
    this.geminiCircuitOpenUntil = 0; // Timestamp when circuit will close (0 = closed/normal)
  }

  initializeModel() {
    const key = this.keyManager.getWorkingKey();
    if (!key) {
      console.error("❌ No Working API Keys available!");
      this.genAI = null;
      this.model = null;
      return;
    }

    // Check if we are actually switching keys or just refreshing
    if (this.currentKey !== key) {
      console.log(`[AIProvider] 🔑 Using API Key ending in ...${key.slice(-4)}`);
      this.currentKey = key;
    }

    this.genAI = new GoogleGenerativeAI(key);
    // Use model from config, defaulting to Flash-Lite if not set
    const modelName = config.ai.gemini.model || 'gemini-2.0-flash-lite';
    this.model = this.genAI.getGenerativeModel({ model: modelName });
  }

  rotateKey() {
    console.log(`[AIProvider] 🔄 Rotation requested... fetching next best key.`);
    this.initializeModel();
  }

  /**
   * Check if a provider is currently in cooldown (failed recently).
   * If cooldown has expired, the provider is available again.
   */
  _isProviderCoolingDown(name) {
    const until = this.providerCooldowns[name];
    if (!until) return false;
    if (Date.now() >= until) {
      // Cooldown expired — provider is available again
      delete this.providerCooldowns[name];
      console.log(`[AIProvider] ✅ ${name} cooldown expired, available again.`);
      return false;
    }
    return true;
  }

  /**
   * Mark a provider as failed, putting it in cooldown.
   */
  _markProviderFailed(name) {
    this.providerCooldowns[name] = Date.now() + this.COOLDOWN_MS;
    const mins = Math.round(this.COOLDOWN_MS / 60000);
    console.warn(`[AIProvider] 🔴 ${name} marked FAILED — cooldown for ${mins} min.`);

    // If the failed provider was the current primary, clear it so the next call picks a new one
    if (this.currentPrimary === name) {
      this.currentPrimary = null;
    }
  }

  /**
   * Mark a provider as working — clear any cooldown and promote it as primary.
   */
  _markProviderWorking(name) {
    if (this.providerCooldowns[name]) {
      delete this.providerCooldowns[name];
    }
    // Promote as current primary (sticky)
    if (this.currentPrimary !== name) {
      console.log(`[AIProvider] 🏆 Promoted ${name} as current primary provider.`);
      this.currentPrimary = name;
    }
  }

  /**
   * Get the ordered list of available providers (not in cooldown).
   * The current "sticky" primary is always first if still available.
   * @param {boolean} isVoiceMode - Skip weak models (Bytez) for voice mode
   */
  _getProviderOrder(isVoiceMode = false) {
    const allProviders = [];

    // Add providers in default priority order
    // Skip Bytez for voice mode — the 3B model can't handle Nepali voice prompts
    if (this.bytezClient && !isVoiceMode) allProviders.push('bytez');
    if (this.openRouter) allProviders.push('openrouter');
    // Gemini: check circuit breaker AND key availability
    const isCircuitOpen = Date.now() < this.geminiCircuitOpenUntil;
    const hasValidKey = !isCircuitOpen && this.keyManager.getWorkingKey() !== null;
    if (hasValidKey && this.model) allProviders.push('gemini');
    if (this.chatGPTBrowser) allProviders.push('chatgpt');

    // Filter out providers in cooldown
    const available = allProviders.filter(p => !this._isProviderCoolingDown(p));

    // If we have a sticky primary and it's available, put it first
    if (this.currentPrimary && available.includes(this.currentPrimary)) {
      const reordered = [this.currentPrimary, ...available.filter(p => p !== this.currentPrimary)];
      return reordered;
    }

    return available;
  }

  /**
   * Main entry point for getting a response (with Sticky Failover)
   */
  async getResponse(message, senderId = 'unknown', senderName = '', isOwnerMode = false, isVoiceMode = false) {
    // 1. Check for Manual Override (if any)
    const override = this.checkManualOverride(message);
    if (override) return override;

    // 2. Get provider order (sticky primary first, skip cooled-down ones)
    const providers = this._getProviderOrder(isVoiceMode);

    if (providers.length === 0) {
      console.error('❌ ALL providers are in cooldown!');
      return "I'm currently updating my systems. Please try again in a minute! 🔧";
    }

    console.log(`[AIProvider] Provider order: [${providers.join(' → ')}]`);

    // 3. Try each provider in order
    for (const provider of providers) {
      try {
        let result;

        switch (provider) {
          case 'bytez':
            console.log('[AIProvider] 🚀 Using Bytez...');
            result = await this.callBytez(message, senderId, senderName, isOwnerMode, isVoiceMode);
            break;

          case 'openrouter':
            console.log('[AIProvider] 🔄 Using OpenRouter...');
            result = await this.callOpenRouter(message, senderId, senderName, isOwnerMode, isVoiceMode);
            break;

          case 'gemini':
            console.log('[AIProvider] 🔄 Using Gemini...');
            result = await this._attemptResponse(message, senderId, senderName, isOwnerMode, isVoiceMode);
            // Gemini-specific success tracking
            this.geminiFailureCount = 0;
            this.keyManager.markKeyWorking(this.currentKey);
            break;

          case 'chatgpt':
            console.log('[AIProvider] 🔄 Using ChatGPT Browser...');
            result = await this.callChatGPT(message, senderId, senderName);
            break;
        }

        // SUCCESS — mark this provider as working (sticky primary)
        this._markProviderWorking(provider);

        // Post-process: strip repetitive greetings/self-intros
        result = this._cleanResponse(result, senderId);

        return result;

      } catch (error) {
        console.warn(`[AIProvider] ⚠️ ${provider} failed: ${error.message}`);

        // Provider-specific failure handling
        if (provider === 'gemini') {
          this.geminiFailureCount++;
          this.keyManager.markKeyFailed(this.currentKey, error);
          this.rotateKey();
          if (this.geminiFailureCount >= 2) {
            this.geminiCircuitOpenUntil = Date.now() + this.COOLDOWN_MS;
            console.warn(`[AIProvider] 🔴 Gemini Circuit TRIPPED!`);
          }
        }

        // Mark provider failed — puts it in cooldown, promotes next one
        this._markProviderFailed(provider);
        // Continue to next provider in the loop
      }
    }

    console.error('❌ ALL providers failed.');
    return "I'm currently updating my systems. Please try again in a minute! 🔧";
  }

  async callBytez(message, senderId, senderName, isOwnerMode, isVoiceMode) {
    const systemInstruction = isVoiceMode
      ? getVoiceSystemPrompt(senderId, isOwnerMode)
      : getSystemPrompt(senderId, isOwnerMode);

    // Retrieve history
    const history = this.history.get(senderId) || [];

    // Convert to Bytez format (assuming OpenAI-like array of messages)
    // History stored as { role: 'user'|'model', parts: [{text}] }
    const messages = [
      { role: "system", content: systemInstruction },
      ...history.map(turn => ({
        role: turn.role === 'model' ? 'assistant' : 'user', // Bytez likely uses 'assistant'
        content: turn.parts[0].text
      })),
      { role: "user", content: `[User: ${senderName}] ${message}` }
    ];

    const model = this.bytezClient.model(config.ai.bytez.model);

    const { error, output } = await model.run(messages);

    if (error) {
      throw new Error(error);
    }

    // Bytez output structure check
    // Sometimes it returns a string that is a JSON object: {"role":"assistant","content":"..."}
    let reply = "";

    // 1. Try to handle if output is already an object
    if (typeof output === 'object' && output !== null) {
      if (output.content) {
        reply = output.content;
      } else if (output.text) {
        reply = output.text;
      } else if (output.output) {
        reply = output.output;
      } else {
        // Fallback: stringify, but we might need to parse it back if it was a nested string
        reply = JSON.stringify(output);
      }
    } else {
      reply = String(output);
    }

    // 2. Check if the resulting string is actually a JSON representation of the message
    // e.g. '{"role":"assistant","content":"Hello"}'
    if (reply.trim().startsWith('{') && reply.includes('"content"')) {
      try {
        const parsed = JSON.parse(reply);
        if (parsed.content) {
          reply = parsed.content;
        } else if (parsed.message && parsed.message.content) {
          reply = parsed.message.content;
        }
      } catch (e) {
        console.warn('[AIProvider] Failed to parse Bytez JSON string:', e.message);
        // Keep original reply if parsing fails
      }
    }

    // Clean up if it returns JSON string with extra quotes (e.g. "{"a":1}") - rare but possible
    if (reply.startsWith('"') && reply.endsWith('"')) {
      try {
        const unquoted = JSON.parse(reply);
        // If unquoted is still a JSON string, try parsing again
      } catch (e) { }
    }

    // cleanup: Remove [Me: Peggy], [Voice: ...], [Mood: ...] or similar prefixes
    // Regex to match [Role: Name] or [Desc] at the start
    reply = reply.replace(/^\[(Me|Peggy|AI|Assistant|Role|Voice|Mood|Tone):?.*?\]\s*/i, "");
    reply = reply.replace(/^(Me|Peggy|AI|Assistant):?\s*/i, "");

    // cleanup: Remove "User:" if it echoes back
    reply = reply.replace(/^User:?\s*/i, "");

    // cleanup: Replace Hindi words with Nepali equivalents (only if user spoke Nepali, not Hindi)
    reply = this._cleanHindiToNepali(reply, message);

    this._updateHistory(senderId, message, reply);
    return reply;
  }

  /**
   * Post-process text to replace common Hindi words with Nepali equivalents.
   * Only activates when User spoke Roman Nepali (not Hindi).
   * If user spoke Hindi, the response is left as-is.
   */
  _cleanHindiToNepali(text, userMessage = '') {
    // Skip if output is pure English or Devanagari
    const hasDevanagari = /[\u0900-\u097F]/.test(text);
    const looksRomanNepali = /\b(cha|chu|chha|huncha|bhayo|garnu|khabar|sanchai|tapaai|tapaiko|hajur|namaste)\b/i.test(text);

    if (hasDevanagari || !looksRomanNepali) {
      return text; // Don't touch pure English or Devanagari text
    }

    // Detect if the USER spoke Hindi (not Nepali)
    // Hindi markers: words that exist in Hindi but NOT in Nepali
    const userSpokeHindi = /\b(kya|kaisa|kaise|aap|aapka|main|hum|humara|hai|hain|thik hai|accha|bahut|lekin|kyun)\b/i.test(userMessage);
    const userSpokeNepali = /\b(cha|chu|chha|huncha|bhayo|garnu|khabar|sanchai|tapaai|tapaiko|hajur|kasto|kasari)\b/i.test(userMessage);

    // If user spoke Hindi and NOT Nepali, skip conversion — let them enjoy Hindi replies
    if (userSpokeHindi && !userSpokeNepali) {
      return text;
    }

    const hindiToNepali = [
      // Pronouns
      [/\bMain\b/gi, 'Ma'],
      [/\bMera\b/gi, 'Mero'],
      [/\bMeri\b/gi, 'Meri'],
      [/\bHum\b/gi, 'Hami'],
      [/\bHumara\b/gi, 'Hamro'],
      [/\bAap\b/gi, 'Hajur'],
      [/\bAapka\b/gi, 'Tapaiko'],
      [/\bAapki\b/gi, 'Tapaiki'],
      [/\bTum\b/gi, 'Timi'],
      [/\bTumhara\b/gi, 'Timro'],
      [/\bUnka\b/gi, 'Unko'],
      [/\bTumhare\b/gi, 'Timro'],
      [/\bTera\b/gi, 'Timro'],
      [/\bTeri\b/gi, 'Timri'],
      [/\bUska\b/gi, 'Usko'],
      [/\bUnke\b/gi, 'Unko'],
      [/\bHujure\b/gi, 'Hajur'],
      [/\bTheek\b/gi, 'Thik'],
      [/\bHokyo\b/gi, 'Bhayo'],

      // Question words
      [/\bKya\b/gi, 'K'],
      [/\bKaisa\b/gi, 'Kasto'],
      [/\bKaise\b/gi, 'Kasari'],
      [/\bKahan\b/gi, 'Kaha'],
      [/\bKab\b/gi, 'Kahile'],
      [/\bKyun\b/gi, 'Kina'],
      [/\bKitna\b/gi, 'Kati'],

      // Verbs / Auxiliaries
      [/\bHai\b/gi, 'Cha'],
      [/\bHain\b/gi, 'Chan'],
      [/\bHun\b/gi, 'Chu'],
      [/\bHo\b/g, 'Ho'],  // case sensitive — "Ho" is also Nepali
      [/\bTha\b/gi, 'Thiyo'],
      [/\bKaro\b/gi, 'Garnu'],
      // Note: "Karta" is also product name, so NOT replaced
      [/\bBolo\b/gi, 'Bhana'],
      [/\bBolna\b/gi, 'Bolna'],
      [/\bSuno\b/gi, 'Sunnu'],
      [/\bDekho\b/gi, 'Hera'],
      [/\bJao\b/gi, 'Jaau'],
      [/\bAao\b/gi, 'Aaunu'],
      [/\bKhana khaya\b/gi, 'Khana khayau'],
      [/\bKarna\b/gi, 'Garnu'],
      [/\bChahte\b/gi, 'Chahanu'],
      [/\bChahiye\b/gi, 'Chahiyo'],
      [/\bManata\b/gi, 'Manauncha'],
      [/\bHota\b/gi, 'Huncha'],
      [/\bHoga\b/gi, 'Hola'],
      [/\bHoiga\b/gi, 'Hola'],
      [/\bLagta\b/gi, 'Lagcha'],
      [/\bRahta\b/gi, 'Bascha'],
      [/\bMilta\b/gi, 'Milcha'],
      [/\bJaata\b/gi, 'Jancha'],

      // Common words
      [/\bAchh?a\b/gi, 'Thik cha'],   // matches Acha AND Achha
      [/\bBahut\b/gi, 'Dherai'],
      [/\bLekin\b/gi, 'Tara'],
      [/\bAur\b/gi, 'Ra'],
      [/\bYa\b/gi, 'Ki'],
      [/\bAbhi\b/gi, 'Ahile'],
      [/\bPhir\b/gi, 'Ani'],
      [/\bSath\b/gi, 'Sanga'],
      [/\bApni\b/gi, 'Aafno'],
      [/\bApna\b/gi, 'Aafno'],
      [/\bHaal\b/gi, 'Khabar'],
      [/\bDin\b/gi, 'Din'],  // same in both
      [/\bChhut\b/gi, 'Bida'],
      [/\bAamtaur par\b/gi, 'Sadhai'],
      [/\bThik hai\b/gi, 'Thik cha'],
      [/\bBhakti\b/gi, 'Maya'],
      [/\bPrati\b/gi, 'Prati'],  // same in Nepali
      [/\bPyaar\b/gi, 'Maya'],
      [/\bPyar\b/gi, 'Maya'],
      [/\bIshq\b/gi, 'Maya'],
      [/\bDost\b/gi, 'Sathi'],
      [/\bDosti\b/gi, 'Saathi'],
      [/\bZindagi\b/gi, 'Jeevan'],
      [/\bKhushi\b/gi, 'Khusi'],
      [/\bBaat\b/gi, 'Kura'],
      [/\bSamajh\b/gi, 'Bujh'],
      [/\bKaam\b/gi, 'Kaam'],
      [/\bRoop\b/gi, 'Rup'],
      [/\bKe roop ma\b/gi, 'ko rup ma'],
      [/\bMahatvapoorn\b/gi, 'Mahatwopoorna'],
      [/\bSthaan\b/gi, 'Thaaun'],
      [/\bBhadra\b/gi, 'Ramro'],
      [/\bJanaana\b/gi, 'Jannu'],
      [/\bJaniye\b/gi, 'Jannus'],
      [/\bRupaye\b/gi, 'Rupiya'],
      [/\bLagta Cha\b/gi, 'Lagcha'],
      [/\bKuch\b/gi, 'Kehi'],
      [/\bSab\b/gi, 'Sabai'],
      [/\bWoh\b/gi, 'Tyo'],
      [/\bYeh\b/gi, 'Yo'],
      [/\bIdhar\b/gi, 'Yaha'],
      [/\bUdhar\b/gi, 'Tyaha'],
      [/\bBhi\b/gi, 'Pani'],
      [/\bSirf\b/gi, 'Matra'],
      [/\bKa\b/g, 'Ko'],   // case sensitive: "ka" → "ko"
      [/\bKe\b/g, 'Ko'],   // case sensitive: "ke" → "ko"
      [/\bKi\b/g, 'Ki'],   // same in Nepali

      // Greetings
      [/\bDhanyavaad\b/gi, 'Dhanyabad'],
      [/\bShukriya\b/gi, 'Dhanyabad'],
    ];

    let cleaned = text;
    for (const [pattern, replacement] of hindiToNepali) {
      cleaned = cleaned.replace(pattern, replacement);
    }

    return cleaned;
  }

  async callChatGPT(message, senderId, senderName) {
    // Browser automation does not support system prompts easily without typing them out.
    // We will just send the user message directly for now to be fast.

    const fullMessage = `(Context: ${senderName}) ${message}`;

    // Use Puppeteer
    const reply = await this.chatGPTBrowser.sendMessage(fullMessage);

    // Update local history
    let chatHistory = this.history.get(senderId);
    if (chatHistory) {
      chatHistory.push(
        { role: 'user', parts: [{ text: message }] },
        { role: 'model', parts: [{ text: reply }] }
      );
    }

    return reply;
  }

  async callOpenRouter(message, senderId, senderName, isOwnerMode, isVoiceMode) {
    const systemPrompt = isVoiceMode
      ? getVoiceSystemPrompt(senderId, isOwnerMode)
      : getSystemPrompt(senderId, isOwnerMode);

    // Convert Gemini history (parts: [{text}]) to OpenAI history (content: string)
    const geminiHistory = this.history.get(senderId) || [];
    const openAIHistory = geminiHistory.map(turn => ({
      role: turn.role === 'model' ? 'assistant' : 'user',
      content: turn.parts[0].text
    }));

    const messages = [
      { role: "system", content: systemPrompt },
      ...openAIHistory,
      { role: "user", content: `[User: ${senderName}] ${message}` }
    ];

    // Try Primary OpenRouter
    try {
      const completion = await this.openRouter.chat.completions.create({
        model: config.ai.openRouter.model || "stepfun/step-3.5-flash:free",
        messages: messages,
      });

      const reply = completion.choices[0].message.content;
      this._updateHistory(senderId, message, reply);
      return reply;

    } catch (primaryError) {
      console.warn(`[AIProvider] ⚠️ Primary OpenRouter Failed: ${primaryError.message}`);

      // Try Backup OpenRouter
      if (this.openRouterBackup) {
        console.log('[AIProvider] 🔄 Switching to OpenRouter Backup...');

        // Get models list or fallback to single model if legacy config
        const backupModels = config.ai.openRouterBackup.models || [config.ai.openRouterBackup.model];

        for (const model of backupModels) {
          try {
            console.log(`[AIProvider] 🔄 Attempting Backup Model: ${model}`);
            const completion = await this.openRouterBackup.chat.completions.create({
              model: model,
              messages: messages,
            });

            const reply = completion.choices[0].message.content;

            // Check for empty or invalid responses common with some free models
            if (!reply || reply.trim().length === 0) {
              throw new Error("Empty response received");
            }

            console.log(`[AIProvider] ✅ Success with backup model: ${model}`);
            this._updateHistory(senderId, message, reply);
            return reply;

          } catch (backupError) {
            console.warn(`[AIProvider] ⚠️ Backup model ${model} failed: ${backupError.message}`);
            // Continue to next model in the loop
          }
        }

        // If loop finishes, all backups failed
        console.error(`[AIProvider] ❌ All Backup OpenRouter models failed.`);
        throw new Error("All backup providers failed");
      } else {
        throw primaryError;
      }
    }
  }

  /**
   * Post-process AI response to strip repetitive greetings and self-introductions.
   * Only allows greeting on the very first interaction with a sender.
   */
  _cleanResponse(text, senderId) {
    if (!text) return text;

    const isFirstMessage = !this.greetedSenders.has(senderId);

    if (isFirstMessage) {
      // First message — allow greeting, mark as greeted
      this.greetedSenders.add(senderId);
      // Still clean up excessive self-intros even on first message
      // Allow ONE "Namaste" or "Ma Peggy" but strip duplicates
      return text;
    }

    let cleaned = text;

    // Strip "Namaste" / "Namaskar" greetings (Roman Nepali)
    cleaned = cleaned.replace(/^(Namaste|Namaskar|Namaskaar)[!,.\s]*/i, '');

    // Strip "नमस्ते" / "नमस्कार" greetings (Devanagari)
    cleaned = cleaned.replace(/^(नमस्ते|नमस्कार)[।!,.\s]*/i, '');

    // Strip self-introductions: "Ma Peggy", "Main Peggy", "I am Peggy", "Ma Peggy hu", "म पेग्गी"
    cleaned = cleaned.replace(/^(Ma|Main|I am|I'm)\s+Peggy[.,!]?\s*/i, '');
    cleaned = cleaned.replace(/^म\s*पेग्गी[।,.\s]*/i, '');
    cleaned = cleaned.replace(/^(Ma|Main|म)\s+(Peggy|पेग्गी)\s*(hu|hun|हुँ|बोल्दै छु|बोल्दैछु)?[।,.\s]*/i, '');

    // Strip "Hey [Name]! Namaste!" patterns
    cleaned = cleaned.replace(/^(Hey|Hi|Hello)[!,]?\s*(Namaste|नमस्ते)[!,.\s]*/i, '');

    // Capitalize first letter if stripping left it lowercase
    if (cleaned && cleaned[0] !== cleaned[0].toUpperCase() && /[a-zA-Z]/.test(cleaned[0])) {
      cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
    }

    return cleaned.trim() || text; // Fallback to original if cleaning removed everything
  }

  _updateHistory(senderId, message, reply) {
    let chatHistory = this.history.get(senderId);
    if (chatHistory) {
      chatHistory.push(
        { role: 'user', parts: [{ text: message }] },
        { role: 'model', parts: [{ text: reply }] }
      );
    }
  }

  _isRetryableError(error) {
    const msg = error.message || '';
    return msg.includes('429') || msg.includes('503') || msg.includes('quota') || msg.includes('fetch failed');
  }

  /**
   * Internal method to perform the actual API call
   */
  async _attemptResponse(message, senderId, senderName, isOwnerMode, isVoiceMode) {
    const systemInstruction = isVoiceMode
      ? getVoiceSystemPrompt(senderId, isOwnerMode)
      : getSystemPrompt(senderId, isOwnerMode);

    // 1. Get or Initialize History
    let chatHistory = this.history.get(senderId);
    if (!chatHistory) {
      chatHistory = [
        {
          role: 'user',
          parts: [{ text: `[SYSTEM_INIT] User Name: ${senderName}. Phone: ${senderId}. Prepare to answer based on system prompt.` }]
        },
        {
          role: 'model',
          parts: [{ text: "Understood. I am Peggy, ready to assist." }]
        }
      ];
      this.history.set(senderId, chatHistory);
    }

    // 2. Prepare the Chat Session
    const chat = this.model.startChat({
      history: chatHistory,
      systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] }
    });

    // 3. Send Message
    const result = await chat.sendMessage(message);
    const responseText = result.response.text();

    // 4. Update Local History
    this.history.get(senderId).push(
      { role: 'user', parts: [{ text: message }] },
      { role: 'model', parts: [{ text: responseText }] }
    );

    // Limit history size to prevent context overflow (last 20 turns)
    if (this.history.get(senderId).length > 20) {
      this.history.set(senderId, this.history.get(senderId).slice(-20));
    }

    // 5. Global History Cleanup (Prevent Memory Leak)
    if (this.history.size > 500) {
      // Remove the oldest interaction (first key in Map)
      const firstKey = this.history.keys().next().value;
      this.history.delete(firstKey);
    }

    return responseText;
  }

  /**
   * Process Multimodal Input (Audio/Image + Text)
   * Uses Gemini 1.5 Flash
   */
  async processMultimodal(base64Data, mimeType, senderId, senderName, isOwnerMode) {
    // Ensure we are using a model that supports audio (Flash 1.5 does)
    if (!this.model) this.initializeModel();

    const systemInstruction = getSystemPrompt(senderId, isOwnerMode);

    // 1. Get History
    let chatHistory = this.history.get(senderId) || [];

    try {
      console.log(`[AIProvider] Multimodal Request (Audio) - sender: ${senderId} - Model: ${config.ai.gemini.model || 'default'}`);

      const lastFewTurns = chatHistory.slice(-4).map(t =>
        `${t.role === 'model' ? 'AI' : 'User'}: ${t.parts[0].text}`
      ).join('\n');

      const promptText = `${systemInstruction}\n\nCONTEXT:\n${lastFewTurns}\n\n[USER SENT AN AUDIO FILE]\nUser's Audio Message: (Respond naturally to this audio)`;

      const result = await this.model.generateContent([
        promptText,
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data
          }
        }
      ]);

      const responseText = result.response.text();

      // Update history manually
      if (!this.history.has(senderId)) this.history.set(senderId, []);

      this.history.get(senderId).push(
        { role: 'user', parts: [{ text: "[AUDIO_MESSAGE]" }] },
        { role: 'model', parts: [{ text: responseText }] }
      );

      return responseText;

    } catch (error) {
      console.error("Multimodal Error:", error.message);

      // Retry logic
      if (this._isRetryableError(error)) {
        console.log("Retrying audio with fresh key...");
        this.keyManager.markKeyFailed(this.currentKey, error);
        this.rotateKey();
        return this.processMultimodal(base64Data, mimeType, senderId, senderName, isOwnerMode);
      }
      return "I had trouble hearing that. Could you say it again or type it?";
    }
  }

  // Placeholder for checkManualOverride
  checkManualOverride(message) {
    return null;
  }

  /**
   * Generate a cold-outreach message
   */
  async generateOutreachMessage() {
    const maxRetries = this.apiKeys ? this.apiKeys.length : 3;
    let attempts = 0;

    // Static messages as fallback or if detailed generation fails
    const staticMessages = [
      "Namaste! 🙏 I'm Peggy, the assistant for Karta Business OS.\n\nKarta helps manage your business easily. I can help you with questions about sales, stock, or accounts. Want to know more?",
      "Hello! I'm Peggy from Karta Business OS. 👋\n\nI'm here to help business owners organize their work. We have a free trial available. Shall I tell you more?",
      "Namaste! I'm Peggy, your AI helper @ Karta. 🤖\n\nI can chat with you about how to make your business easier to run. Let me know if you are interested!"
    ];

    return staticMessages[Math.floor(Math.random() * staticMessages.length)];
  }

  // Compatibility methods for whatsappClient.js
  getAnalytics() {
    return {
      totalUsers: this.history.size,
      messageCount: 0,
      status: 'Gemini-Flash Mode Active'
    };
  }

  getPersonality() {
    return { name: "Aju (Gemini Powered)", status: "Online" };
  }

  /**
   * Generates a step-by-step execution plan for God Mode
   * Returns a JSON object with { thought: string, steps: [] }
   */
  async generatePlan(userMessage) {
    try {
      console.log(`[AIProvider] 🧠 Generating plan for: "${userMessage}"`);

      const toolsDefinition = `
You are the Brain of a "God Mode" system automation agent.
Your goal is to break down the USER REQUEST into a sequence of specific TOOL ACTIONS.
Return ONLY valid JSON. No markdown formatting.

AVAILABLE TOOLS:
1. file_write(path, content) - Create/overwrite a file.
2. file_read(path) - Read file content.
3. file_list(path) - List files in a directory.
4. folder_create(path) - Create a new directory.
5. folder_delete(path) - Delete a directory (careful!).
6. file_delete(path) - Delete a file.
7. browser_open(url, profile, browser) - Open a URL. OPTIONAL: 'profile' (e.g. 'Default'), 'browser' ('chrome', 'brave', 'edge'). Default is Chrome.
8. browser_navigate(url) - Navigate active tab to URL.
9. browser_search(query) - Google search.
10. youtube_play(query) - Play video on YouTube.
11. app_open(name) - Open desktop app (notepad, calc, chrome, etc).
12. app_close(name) - Kill a process/app.
13. system_exec(command) - Run a raw shell command (cmd.exe). Use sparingly.
14. file_download(url, path) - Download a file from the internet.
15. browser_content() - Get text content from the active browser tab (for scraping/reading).
16. run_script(code, language) - Execute a custom Node.js script. Use this if NO other tool can do the job (Dynamic Learning). Code must be complete and valid.
17. whatsapp_send(path, caption) - Send a file (path) or text message (caption) back to the user on WhatsApp.
18. browser_click(selector, text) - Click an element on the active page. Provide either a CSS selector OR the visible text of the button/link. useful for commands like "click [text]".

RESPONSE FORMAT:
{
  "thought": "Brief reasoning...",
  "steps": [
    { "tool": "browser_open", "params": { "url": "https://example.com" }, "description": "Open site" },
    { "tool": "browser_click", "params": { "text": "Login" }, "description": "Click login button" }
  ]
}

USER REQUEST: "${userMessage}"
`;

      // Use OpenRouter if available (better reasoning models), else Gemini
      let planText = "";

      if (this.openRouter) {
        try {
          console.log('[AIProvider] 🧠 Using OpenRouter for Planning...');
          const completion = await this.openRouter.chat.completions.create({
            model: config.ai.openRouter.model || "stepfun/step-3.5-flash:free", // Default or Configured
            messages: [
              { role: "system", content: toolsDefinition },
              { role: "user", content: `USER REQUEST: "${userMessage}"` }
            ]
          });
          planText = completion.choices[0].message.content;
        } catch (orError) {
          console.error('[AIProvider] OpenRouter Planning Failed:', orError.message);
          // Fallback to Gemini handled below if planText is empty
        }
      }

      if (!planText && this.model) {
        console.log('[AIProvider] 🧠 Using Gemini for Planning...');
        const result = await this.model.generateContent(toolsDefinition);
        planText = result.response.text();
      }

      if (!planText) {
        throw new Error("No AI model available for planning");
      }

      // Clean up markdown code blocks if present
      const jsonStr = planText.replace(/```json/g, '').replace(/```/g, '').trim();

      try {
        const plan = JSON.parse(jsonStr);
        return plan;
      } catch (e) {
        console.error("Failed to parse AI Plan JSON:", planText);
        return { error: "Failed to parse plan" };
      }

    } catch (error) {
      console.error("[AIProvider] Planning failed:", error);
      return { error: error.message };
    }
  }

  getProfiles() {
    return {};
  }
}

module.exports = AIProvider;
