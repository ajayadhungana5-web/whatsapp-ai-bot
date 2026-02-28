/**
 * GOD MODE EXECUTOR - UNRESTRICTED FULL SYSTEM AUTOMATION
 * 
 * Complete Laptop Control:
 * - Execute ANY command (PowerShell, CMD, bash)
 * - File operations (copy, move, delete, organize, search)
 * - Application launching and control
 * - Desktop automation (click, type, move mouse)
 * - Browser full control (navigate, click, fill forms)
 * - Media control (play, pause, volume, skip)
 * - Window management (minimize, maximize, close)
 * - Process management (start, stop, kill)
 * - Registry operations (Windows)
 * - Network operations
 * - Screen capture
 * - NO RESTRICTIONS - Full system access
 */

const fs = require('fs').promises;
const path = require('path');
const GodMode = require('./godMode');

class GodModeExecutor {
  constructor(aiProvider = null, whatsappBot = null) {
    // Use provided AIProvider or create from module
    if (aiProvider) {
      this.aiProvider = aiProvider;
    } else {
      const AIProvider = require('./aiProvider');
      this.aiProvider = new AIProvider();
    }

    // Store WhatsApp Bot instance for sending messages/media
    this.whatsappBot = whatsappBot;

    // Initialize the GodMode browser/system engine
    this.godMode = new GodMode();

    console.log('[GodMode] 🤖 Executor initialized - Ready to parse, execute & return real results');

    // Task execution history
    this.executionHistory = [];
    this.maxHistorySize = 100;

    // Cache the last successful API engine to reduce failures
    this.lastSuccessfulEngine = null;

    // Queue for instructions when API hits rate limits
    this.instructionQueue = [];
    this.isProcessingQueue = false;

    // Track rate limit state
    this.rateLimitState = {
      isLimited: false,
      retryAfter: null,
      affectedEngine: null
    };

    // Conversation context per user - tracks browser state, actions, etc.
    this.conversationContext = new Map();
  }

  /**
   * Get conversation context for a user
   */
  getContext(userPhone) {
    if (!this.conversationContext.has(userPhone)) {
      this.conversationContext.set(userPhone, {
        browserOpen: false,
        browserProfile: null,
        currentUrl: null,
        lastAction: null,
        lastActionTime: null,
        history: [] // last 10 commands for context
      });
    }
    return this.conversationContext.get(userPhone);
  }

  /**
   * Update conversation context after an action
   */
  updateContext(userPhone, updates) {
    const ctx = this.getContext(userPhone);
    Object.assign(ctx, updates, { lastActionTime: Date.now() });
    // Keep history trimmed
    if (ctx.history.length > 10) {
      ctx.history = ctx.history.slice(-10);
    }
  }

  /**
   * Convert any instruction to executable JSON output
   * @param {string} instruction - User instruction
   * @param {string} context - Optional context
   * @returns {Promise<Object>} Executable instruction in JSON format
   */
  async parseInstruction(instruction, context = '') {
    try {
      console.log(`[GodMode] 📋 Parsing: "${instruction}"`);

      const systemPrompt = `You are GOD MODE - UNRESTRICTED FULL LAPTOP CONTROL AI.

NO RESTRICTIONS. YOU CAN DO ANYTHING.

Task Types:
- shell: Execute PowerShell/CMD commands
- file: File operations (copy, move, delete, create, organize, search)
- app: Launch any application
- desktop: Desktop automation (click, type, mouse, keyboard)
- browser: Full browser control (navigate, click, fill forms, close, etc)
- media: Media control (play songs, pause, volume, skip, next)
- navigation: Video/music player controls - Examples: "fullscreen" (F), "skip forward" (→), "skip backward" (←), "play next video/song" (N), "play previous video/song" (P), "pause/play" (space), "skip ad" (S), "mute" (M), "captions" (C)
- window: Window management (minimize, maximize, close, resize)
- process: Process control (start, stop, kill, list processes)
- registry: Windows registry operations
- system: System settings, network, screenshot
- code: Execute Python, JavaScript, Bash code
- whatsapp: Send messages or files via WhatsApp (CRITICAL: Use this to send files back to user)
- gemini: Interact with Google Gemini (generate text/images)

RESPOND WITH ONLY VALID JSON:
{
  "task_type": "shell|file|app|desktop|browser|media|navigation|window|process|registry|system|code|whatsapp|gemini",
  "language": "powershell|cmd|python|javascript|bash|vbscript|autohotkey|json",
  "output": "exact command/code or file path to send",
  "notes": "what it does",
  "dependencies": [],
  "fallback": "alternative if fails",
  "next_steps": []
}

BE SPECIFIC. BE DIRECT. NO LIMITATIONS.`;

      const userPrompt = `Task: "${instruction}"
${context ? `Context: ${context}` : ''}

RESPOND WITH ONLY JSON:`;

      // Get response from AI Provider
      let responseText = await this.aiProvider.getResponse(userPrompt, 'god-mode-unrestricted');

      console.log('[GodMode] 📝 Received response, parsing...');

      // Clean response
      responseText = responseText.trim();
      responseText = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

      // Extract JSON
      let jsonText = responseText;
      if (!jsonText.startsWith('{')) {
        const idx = jsonText.indexOf('{');
        if (idx !== -1) {
          jsonText = jsonText.substring(idx);
        }
      }

      // Find complete JSON
      let braceCount = 0;
      let jsonEnd = -1;
      for (let i = 0; i < jsonText.length; i++) {
        if (jsonText[i] === '{') braceCount++;
        if (jsonText[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }

      if (jsonEnd !== -1) {
        jsonText = jsonText.substring(0, jsonEnd);
      }

      const result = JSON.parse(jsonText);

      // Validate fields
      if (!result.task_type) result.task_type = 'shell';
      if (!result.language) result.language = 'powershell';
      if (!result.output) result.output = '';
      if (!result.notes) result.notes = 'Unrestricted execution';
      if (!Array.isArray(result.dependencies)) result.dependencies = [];
      if (typeof result.fallback !== 'string') result.fallback = 'No fallback';
      if (!Array.isArray(result.next_steps)) result.next_steps = [];

      console.log(`[GodMode] ✅ Parsed as ${result.task_type} (${result.language})`);

      return result;

    } catch (error) {
      console.error('[GodMode] ❌ Parse Error:', error.message);

      return {
        task_type: 'error',
        language: 'powershell',
        output: `Error: ${error.message}`,
        notes: 'Failed to parse',
        dependencies: [],
        fallback: 'Rephrasing instruction',
        next_steps: []
      };
    }
  }

  /**
   * Parse instruction AND automatically execute it
   * Main entry point: Instruction → Execution → Results
   */
  async executeInstruction(instruction, context = '', userPhone = null) {
    try {
      console.log(`[GodMode] 🚀 Full execution starting: "${instruction}"`);

      // Track in conversation history
      if (userPhone) {
        const ctx = this.getContext(userPhone);
        ctx.history.push({ instruction, time: Date.now() });
        if (ctx.history.length > 10) ctx.history = ctx.history.slice(-10);
      }

      // Step 1: Check if rate limited - queue if needed
      if (this.rateLimitState.isLimited) {
        console.log('[GodMode] ⏳ Rate limited - queueing instruction');
        this.instructionQueue.push({ instruction, context, userPhone, timestamp: Date.now() });
        return {
          status: 'queued',
          message: `⏳ API rate limited. Your instruction has been queued and will execute in ${this.rateLimitState.retryAfter || 2} seconds.`,
          instruction,
          retryAfter: this.rateLimitState.retryAfter
        };
      }

      // Step 2: Detect system/file operations (desktop actions) - now with context
      const systemResult = await this.detectAndExecuteSystemTask(instruction, userPhone);
      if (systemResult) {
        return systemResult;
      }

      // Step 3: Parse instruction → JSON
      const parsedPlan = await this.parseInstruction(instruction, context);

      if (parsedPlan.task_type === 'error') {
        console.error('[GodMode] ❌ Parsing failed');
        return {
          status: 'error',
          message: `❌ Error: ${parsedPlan.output}`,
          instruction,
          fallback: parsedPlan.fallback
        };
      }

      console.log(`[GodMode] ✅ Parsed as ${parsedPlan.task_type} (${parsedPlan.language})`);

      // Step 4: Automatically execute based on task type
      const executionResult = await this.execute(parsedPlan, userPhone);

      // Step 5: Try to queue if rate limited during execution
      if (executionResult.status === 'rate_limited') {
        this.setRateLimit(executionResult.retryAfter);
        this.instructionQueue.push({ instruction, context, userPhone, timestamp: Date.now() });
        return {
          status: 'queued',
          message: `⏳ Hit rate limit during execution. Queued for retry.`,
          instruction
        };
      }

      // Step 6: Return results
      console.log(`[GodMode] ✨ Execution complete: ${executionResult.status}`);

      // Log to history
      await this.logExecution({
        instruction,
        taskType: parsedPlan.task_type,
        status: executionResult.status,
        result: executionResult.result,
        timestamp: new Date().toISOString(),
        userPhone
      });

      // Start queue processor
      if (this.instructionQueue.length > 0) {
        this.processQueue(userPhone);
      }

      return executionResult;

    } catch (error) {
      console.error('[GodMode] ❌ Execution error:', error.message);
      return {
        status: 'error',
        message: `Error executing instruction: ${error.message}`,
        instruction,
        fallback: 'Try rephrasing your instruction'
      };
    }
  }

  /**
   * Detect and execute system/file tasks (desktop automations)
   * Now with context-aware browser/YouTube/search detection
   */
  async detectAndExecuteSystemTask(instruction, userPhone = null) {
    const cmd = instruction.toLowerCase();
    const ctx = userPhone ? this.getContext(userPhone) : { browserOpen: false };
    console.log(`[GodMode] 🕵️ Context Check: browserOpen=${ctx.browserOpen}`);

    // ============ YOUTUBE OPERATIONS (check first - most specific) ============
    // "play X on youtube", "youtube play X", "search youtube for X", "open youtube and play X"
    if ((cmd.includes('youtube') || cmd.includes('yt')) &&
      (cmd.includes('play') || cmd.includes('search') || cmd.includes('open'))) {
      return await this.youtubeSearch(instruction, userPhone);
    }
    // "play X" when browser is already open on YouTube
    if (cmd.includes('play') && !cmd.includes('song') && !cmd.includes('mp3') && !cmd.includes('audio') &&
      ctx.browserOpen && ctx.currentUrl && ctx.currentUrl.includes('youtube')) {
      return await this.youtubeSearch(instruction, userPhone);
    }

    // ============ PLAYBACK NAVIGATION (Next/Previous Video/Song) ============
    // "next video", "next song", "previous video", "previous song", "play next", etc.
    if (cmd.includes('next') && (cmd.includes('video') || cmd.includes('song') || cmd.includes('track'))) {
      return await this.executeInstruction('press n key to play next', '', userPhone);
    }
    if (cmd.includes('previous') && (cmd.includes('video') || cmd.includes('song') || cmd.includes('track'))) {
      return await this.executeInstruction('press p key to play previous', '', userPhone);
    }

    // ============ MEDIA CONTROLS (local audio) ============
    if (cmd.includes('play') && (cmd.includes('song') || cmd.includes('music') || cmd.includes('mp3') || cmd.includes('audio'))) {
      return await this.playAudio(instruction);
    }
    if (cmd.includes('pause')) {
      return await this.pauseMedia();
    }
    if (cmd.includes('forward') || (cmd.includes('next') && !cmd.includes('video') && !cmd.includes('song'))) {
      return await this.nextTrack();
    }
    if (cmd.includes('backward') || (cmd.includes('previous') && !cmd.includes('video') && !cmd.includes('song'))) {
      return await this.previousTrack();
    }

    // ============ BROWSER OPERATIONS ============
    // Check for complex/generative intent that requires full AI planning (Smart Handoff)
    // e.g. "open chrome and make a poster" -> Fall through to AI Agent
    const hasComplexIntent = cmd.includes('make ') || cmd.includes('generate ') || cmd.includes('create ') ||
      cmd.includes('download') || cmd.includes('send ') || cmd.includes('write ') ||
      cmd.includes('analysis') || (cmd.includes(' and ') && cmd.includes('open ')); // multiple opens usually need planning

    console.log(`[GodMode] 🕵️ Smart Handoff Check: cmd="${cmd}", complex=${hasComplexIntent}`);

    if ((cmd.includes('open browser') || cmd.includes('open chrome') || cmd.includes('open chrom') || cmd.includes('open firefox') || cmd.includes('open edge')) && !hasComplexIntent) {
      return await this.openBrowser(instruction, userPhone);
    }
    if (cmd.includes('open google') || cmd.includes('google search')) {
      return await this.googleSearch(instruction);
    }

    // Browser search/navigate when browser is open: "search X", "go to X", "open X"
    // When browser is open, general "search X" goes to browser, not file search
    // Only route to file_search if it's explicitly "search file" or "search for file"
    if (ctx.browserOpen) {
      const isExplicitFileSearch = /search\s+(for\s+)?(a\s+)?file\b/i.test(cmd) ||
        /search\s+(for\s+)?(a\s+)?document\b/i.test(cmd) ||
        /find\s+(a\s+)?file\b/i.test(cmd);
      if (cmd.includes('search') && !isExplicitFileSearch) {
        return await this.browserSearch(instruction, userPhone);
      }
      if ((cmd.startsWith('go to ') || cmd.startsWith('open ') || cmd.startsWith('navigate to ')) &&
        !cmd.includes('folder') && !cmd.includes('app')) {
        return await this.browserSearch(instruction, userPhone);
      }
    }

    // ============ FILE OPERATIONS ============
    if (cmd.includes('open file') || cmd.includes('open document')) {
      return await this.openFile(instruction);
    }
    if (cmd.includes('search') && cmd.includes('file')) {
      return await this.searchFile(instruction);
    }
    if (cmd.includes('move') && cmd.includes('file')) {
      return await this.moveFile(instruction);
    }
    if (cmd.includes('copy') && cmd.includes('file')) {
      return await this.copyFile(instruction);
    }
    if (cmd.includes('delete') && cmd.includes('file')) {
      return await this.deleteFile(instruction);
    }

    // Desktop organization
    if (cmd.includes('organize') || cmd.includes('arrange') || cmd.includes('sort')) {
      return await this.organizeDesktop(instruction);
    }
    if (cmd.includes('desktop') && cmd.includes('clean')) {
      return await this.cleanDesktop();
    }

    // File manager
    if (cmd.includes('open file manager') || cmd.includes('open files') || cmd.includes('show folder')) {
      return await this.openFileManager();
    }

    // General file/folder operations
    if (cmd.includes('create folder') || cmd.includes('create directory')) {
      return await this.createFolder(instruction);
    }
    if (cmd.includes('rename') && cmd.includes('file')) {
      return await this.renameFile(instruction);
    }

    // Close application
    if (cmd.includes('close') && (cmd.includes('app') || cmd.includes('application') || cmd.includes('window') ||
      cmd.includes('vs') || cmd.includes('chrome') || cmd.includes('firefox') || cmd.includes('notepad') ||
      cmd.includes('code') || cmd.includes('excel') || cmd.includes('word') || cmd.includes('outlook') ||
      cmd.includes('teams') || cmd.includes('discord') || cmd.includes('zoom'))) {
      // Also update browser context if closing browser
      if (userPhone && (cmd.includes('chrome') || cmd.includes('browser') || cmd.includes('firefox'))) {
        this.updateContext(userPhone, { browserOpen: false, currentUrl: null, browserProfile: null });
      }
      return await this.closeApplication(instruction);
    }

    // Return null if no system task detected
    return null;
  }

  /**
   * Play audio/song
   */
  async playAudio(instruction) {
    try {
      console.log('[GodMode] 🎵 Playing audio...');

      // Extract filename from instruction
      const match = instruction.match(/play['\"]?\s+([^'\"]+)/i) ||
        instruction.match(/song['\"]?\s+([^'\"]+)/i) ||
        instruction.match(/music['\"]?\s+([^'\"]+)/i);

      const filename = match ? match[1].trim() : null;

      if (filename) {
        // Try to find and play the file
        const { execSync } = require('child_process');

        try {
          // Windows command to play audio
          execSync(`powershell -Command "Get-ChildItem -Path $env:USERPROFILE -Filter '*${filename}*' -Recurse | select -first 1 | % { Invoke-Item $_.FullName }"`, {
            timeout: 5000
          });

          return {
            status: 'success',
            output: `▶️ Playing: ${filename}`,
            message: `Now playing: ${filename}`,
            type: 'audio_playback'
          };
        } catch (e) {
          return {
            status: 'success',
            output: `Command sent to system`,
            message: `▶️ Attempting to play: ${filename}`,
            type: 'audio_playback'
          };
        }
      }

      return {
        status: 'error',
        output: 'No filename specified',
        message: '❌ Please specify the song name: "Play song.mp3"'
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Audio playback failed'
      };
    }
  }

  /**
   * Pause media
   */
  async pauseMedia() {
    try {
      console.log('[GodMode] ⏸️ Pausing media...');

      // Send space key for play/pause (works on YouTube, most players)
      const psCommand = `
\$wshell = New-Object -ComObject WScript.Shell
\$wshell.SendKeys(' ')
Start-Sleep -Milliseconds 100
Write-Host "✅ Pause command sent"
`;

      return await this.runCommand(psCommand);
    } catch (error) {
      return {
        status: 'success',
        output: 'Pause command sent',
        message: '⏸️ Sent pause command (space key)',
        type: 'media_control'
      };
    }
  }

  /**
   * Next track
   */
  async nextTrack() {
    try {
      console.log('[GodMode] ⏭️ Next track...');

      // Send 'n' key for next (works on YouTube)
      const psCommand = `
\$wshell = New-Object -ComObject WScript.Shell
\$wshell.SendKeys('n')
Start-Sleep -Milliseconds 100
Write-Host "✅ Next command sent"
`;

      return await this.runCommand(psCommand);
    } catch (error) {
      return {
        status: 'success',
        output: 'Next command sent',
        message: '⏭️ Skipped to next (n key)',
        type: 'media_control'
      };
    }
  }

  /**
   * Previous track
   */
  async previousTrack() {
    try {
      console.log('[GodMode] ⏮️ Previous track...');

      // Send 'p' key for previous (works on YouTube)
      const psCommand = `
\$wshell = New-Object -ComObject WScript.Shell
\$wshell.SendKeys('p')
Start-Sleep -Milliseconds 100
Write-Host "✅ Previous command sent"
`;

      return await this.runCommand(psCommand);
    } catch (error) {
      return {
        status: 'success',
        output: 'Previous command sent',
        message: '⏮️ Went back to previous (p key)',
        type: 'media_control'
      };
    }
  }

  /**
   * Open browser with profile support using Puppeteer via GodMode
   */
  async openBrowser(instruction, userPhone = null) {
    try {
      console.log('[GodMode] 🌐 Opening browser with profile support...');

      let browserType = 'chrome';
      if (instruction.toLowerCase().includes('firefox')) browserType = 'firefox';
      if (instruction.toLowerCase().includes('edge')) browserType = 'edge';
      if (instruction.toLowerCase().includes('brave')) browserType = 'brave';

      // Check for requested profile in instruction (e.g. "profile 3", "profile work")
      const profileMatch = instruction.match(/profile\s+['"]?([a-zA-Z0-9]+)['"]?/i);
      const requested = profileMatch ? profileMatch[1] : null;

      // Get available Chrome profiles
      let profile = 'Default';
      try {
        const profiles = await this.godMode.getChromeProfiles();
        console.log(`[GodMode] Found ${profiles.length} Chrome profiles: ${profiles.join(', ')}`);

        let found = false;
        if (requested) {
          // Try exact match (case insensitive)
          const exact = profiles.find(p => p.toLowerCase() === requested.toLowerCase());
          // Try "Profile X" for number X
          const numeric = profiles.find(p => p.toLowerCase() === `profile ${requested.toLowerCase()}`);

          if (exact) { profile = exact; found = true; }
          else if (numeric) { profile = numeric; found = true; }
        }

        if (!found) {
          // Auto-select most recently used profile (profiles[0] is newest)
          if (profiles.length > 0) {
            profile = profiles[0];
            console.log(`[GodMode] 💡 Auto-selected active profile: ${profile} (Last Used)`);
          } else if (profiles.includes('Default')) {
            profile = 'Default';
          }
        }
      } catch (e) {
        console.warn('[GodMode] Could not detect profiles, using Default');
      }

      // Launch browser with profile via Puppeteer
      const result = await this.godMode.browserAutomate(null, [], browserType, profile);
      console.log(`[GodMode] Browser launch result: ${result}`);

      // Update conversation context
      if (userPhone) {
        this.updateContext(userPhone, {
          browserOpen: true,
          browserProfile: profile,
          currentUrl: 'about:blank',
          lastAction: 'opened browser',
          history: [...(this.getContext(userPhone).history || []), { action: 'open_browser', time: Date.now() }]
        });
      }

      return {
        status: 'success',
        output: `Chrome opened with profile: ${profile}`,
        message: `🌐 Chrome opened`,
        type: 'browser_action'
      };
    } catch (error) {
      console.error('[GodMode] Browser open error:', error.message);
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to open browser'
      };
    }
  }

  /**
   * YouTube search and play - uses Puppeteer browser automation
   */
  async youtubeSearch(instruction, userPhone = null) {
    try {
      console.log('[GodMode] 🎵 YouTube search/play...');

      // Extract search query from various patterns
      let query = instruction;

      // Pattern matching for YouTube queries
      const patterns = [
        /(?:play|search)\s+(?:on\s+)?(?:youtube|yt)\s+(?:for\s+)?['"]?(.+?)['"]?$/i,
        /(?:youtube|yt)\s+(?:play|search)\s+(?:for\s+)?['"]?(.+?)['"]?$/i,
        /(?:open\s+)?(?:youtube|yt)\s+(?:and\s+)?(?:play|search)\s+(?:for\s+)?['"]?(.+?)['"]?$/i,
        /(?:search|play)\s+(?:for\s+)?['"]?(.+?)['"]?\s+(?:on|in)\s+(?:youtube|yt)/i,
        /(?:play|search)\s+['"]?(.+?)['"]?\s+(?:on|in)\s+(?:youtube|yt)/i,
      ];

      for (const pattern of patterns) {
        const match = instruction.match(pattern);
        if (match && match[1]) {
          query = match[1].trim();
          break;
        }
      }

      // Fallback: remove common keywords to get the search term
      if (query === instruction) {
        query = instruction
          .replace(/open|youtube|yt|play|search|for|on|in|and|the|latest|song|video|music/gi, '')
          .trim();
      }

      if (!query || query.length === 0) {
        query = 'trending music';
      }

      console.log(`[GodMode] YouTube query: "${query}"`);

      // Ensure browser is open with profile
      const ctx = userPhone ? this.getContext(userPhone) : { browserOpen: false };
      if (!ctx.browserOpen || !this.godMode.activeBrowser || !this.godMode.activeBrowser.isConnected()) {
        // Auto-open browser first
        console.log('[GodMode] Browser not open, launching first...');
        let profile = 'Default';
        try {
          const profiles = await this.godMode.getChromeProfiles();
          if (profiles.includes('Default')) profile = 'Default';
          else if (profiles.length > 0) profile = profiles[0];
        } catch (e) { /* use Default */ }

        await this.godMode.browserAutomate(null, [], 'chrome', profile);
        if (userPhone) {
          this.updateContext(userPhone, { browserOpen: true, browserProfile: profile });
        }
      }

      // Use GodMode's YouTube play function
      const result = await this.godMode.youtubePlay(query);
      console.log(`[GodMode] YouTube result: ${result}`);

      // Update context
      if (userPhone) {
        this.updateContext(userPhone, {
          currentUrl: `https://youtube.com/results?search_query=${encodeURIComponent(query)}`,
          lastAction: `youtube: ${query}`,
          history: [...(this.getContext(userPhone).history || []), { action: 'youtube_play', query, time: Date.now() }]
        });
      }

      return {
        status: 'success',
        output: `Playing "${query}" on YouTube`,
        message: `🎵 Playing "${query}" on YouTube`,
        type: 'browser_action'
      };
    } catch (error) {
      console.error('[GodMode] YouTube error:', error.message);
      return {
        status: 'error',
        output: error.message,
        message: '❌ YouTube playback failed'
      };
    }
  }

  /**
   * Browser search/navigate - search or go to URL in active browser
   */
  async browserSearch(instruction, userPhone = null) {
    try {
      console.log('[GodMode] 🔍 Browser search/navigate...');

      let target = instruction;

      // Extract target from instruction
      const patterns = [
        /(?:search|search for)\s+['"]?(.+?)['"]?$/i,
        /(?:go to|goto|navigate to|open)\s+['"]?(.+?)['"]?$/i,
      ];

      for (const pattern of patterns) {
        const match = instruction.match(pattern);
        if (match && match[1]) {
          target = match[1].trim();
          break;
        }
      }

      // Determine if it's a URL or a search query
      let url;
      if (target.includes('.com') || target.includes('.org') || target.includes('.net') ||
        target.includes('http') || target.includes('www')) {
        // It's a URL
        url = target.startsWith('http') ? target : `https://${target}`;
      } else {
        // It's a search query - use Google
        url = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
      }

      // Navigate using active browser page
      if (this.godMode.activePage) {
        try {
          await this.godMode.activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

          // Check for Google CAPTCHA/Blocking
          const pageTitle = await this.godMode.activePage.title();
          const currentUrl = this.godMode.activePage.url();

          // Google "Sorry" page is the standard CAPTCHA block
          if (pageTitle.includes('Sorry') || currentUrl.includes('google.com/sorry') || pageTitle.includes('Unusual traffic')) {
            console.warn('[GodMode] Google CAPTCHA detected! Switching to Bing fallback.');
            // Fallback to Bing
            const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(target)}`;
            await this.godMode.activePage.goto(bingUrl, { waitUntil: 'domcontentloaded' });
            url = bingUrl; // Update tracked URL
          }

        } catch (navErr) {
          console.warn('[GodMode] Navigation attempt:', navErr.message);
        }
      } else {
        // Fallback: use browserAutomate
        await this.godMode.browserAutomate(url);
      }

      // Update context
      if (userPhone) {
        this.updateContext(userPhone, {
          currentUrl: url,
          lastAction: `navigated: ${target}`,
          history: [...(this.getContext(userPhone).history || []), { action: 'browser_navigate', target, time: Date.now() }]
        });
      }

      return {
        status: 'success',
        output: `Navigated to: ${target}`,
        message: `🌐 Opened: ${target}`,
        type: 'browser_action'
      };
    } catch (error) {
      console.error('[GodMode] Browser search error:', error.message);
      return {
        status: 'error',
        output: error.message,
        message: '❌ Browser navigation failed'
      };
    }
  }

  /**
   * Google search
   */
  async googleSearch(instruction) {
    try {
      console.log('[GodMode] 🔍 Google search...');

      // Extract search term
      const match = instruction.match(/(?:google|search)\s+(?:for\s+)?['\"]?([^'\"]+)/i);
      const searchTerm = match ? match[1].trim() : 'google.com';

      const { execSync } = require('child_process');

      const url = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`;
      execSync(`start ${url}`, { timeout: 3000 });

      return {
        status: 'success',
        output: `Searched: ${searchTerm}`,
        message: `🔍 Searching Google for: ${searchTerm}`,
        type: 'browser_action'
      };
    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Google search failed'
      };
    }
  }

  /**
   * Open file
   */
  async openFile(instruction) {
    try {
      console.log('[GodMode] 📂 Opening file...');

      const { execSync } = require('child_process');
      const fs = require('fs');

      // Extract filename
      const match = instruction.match(/open\s+['\"]?([^'\"]+)/i);
      const filename = match ? match[1].trim() : null;

      if (!filename) {
        return {
          status: 'error',
          output: 'No filename specified',
          message: '❌ Please specify file name: "Open document.pdf"'
        };
      }

      // Search for file
      const searchPaths = [
        process.cwd(),
        path.join(process.env.USERPROFILE, 'Documents'),
        path.join(process.env.USERPROFILE, 'Downloads'),
        path.join(process.env.USERPROFILE, 'Desktop')
      ];

      let foundFile = null;
      for (const dir of searchPaths) {
        try {
          const files = fs.readdirSync(dir);
          const found = files.find(f => f.toLowerCase().includes(filename.toLowerCase()));
          if (found) {
            foundFile = path.join(dir, found);
            break;
          }
        } catch (e) {
          // Continue searching
        }
      }

      if (foundFile) {
        execSync(`start "" "${foundFile}"`, { timeout: 3000 });
        return {
          status: 'success',
          output: `Opened: ${path.basename(foundFile)}`,
          message: `📂 Opened: ${path.basename(foundFile)}`,
          type: 'file_action'
        };
      }

      return {
        status: 'error',
        output: `File not found: ${filename}`,
        message: `❌ Could not find: ${filename}`
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to open file'
      };
    }
  }

  /**
   * Search for file
   */
  async searchFile(instruction) {
    try {
      console.log('[GodMode] 🔍 Searching for file...');

      const { execSync } = require('child_process');
      const fs = require('fs');

      // Extract search term
      const match = instruction.match(/search\s+(?:for\s+)?['\"]?([^'\"]+)/i);
      const searchTerm = match ? match[1].trim() : null;

      if (!searchTerm) {
        return {
          status: 'error',
          output: 'No search term specified',
          message: '❌ Specify file name to search'
        };
      }

      // Search in common directories
      const searchPaths = [
        process.env.USERPROFILE
      ];

      let results = [];

      for (const dir of searchPaths) {
        try {
          const foundFiles = execSync(
            `powershell -Command "Get-ChildItem -Path '${dir}' -Filter '*${searchTerm}*' -Recurse | Select-Object FullName | head -10"`,
            { encoding: 'utf-8' }
          ).split('\n').filter(l => l.trim());

          results = results.concat(foundFiles);
        } catch (e) {
          // Continue
        }
      }

      if (results.length > 0) {
        return {
          status: 'success',
          output: `Found ${results.length} files:\n${results.slice(0, 5).join('\n')}`,
          message: `🔍 Found ${results.length} files matching '${searchTerm}'`,
          type: 'file_search'
        };
      }

      return {
        status: 'success',
        output: `No files found for: ${searchTerm}`,
        message: `❌ No files found for: ${searchTerm}`
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ File search failed'
      };
    }
  }

  /**
   * Move file
   */
  async moveFile(instruction) {
    try {
      console.log('[GodMode] 📦 Moving file...');

      const { execSync } = require('child_process');
      const fs = require('fs');

      // Parse: "Move file.txt to Desktop"
      const match = instruction.match(/move\s+['\"]?([^'\"]+)['\"]?\s+to\s+([^\s]+)/i);
      if (!match) {
        return {
          status: 'error',
          output: 'Invalid syntax',
          message: '❌ Use: "Move filename to Desktop/Documents/Downloads"'
        };
      }

      const [, filename, destination] = match;
      const commonDirs = {
        'desktop': path.join(process.env.USERPROFILE, 'Desktop'),
        'documents': path.join(process.env.USERPROFILE, 'Documents'),
        'downloads': path.join(process.env.USERPROFILE, 'Downloads')
      };

      const destPath = commonDirs[destination.toLowerCase()] || destination;

      // Find source file
      const searchPaths = [
        process.cwd(),
        path.join(process.env.USERPROFILE, 'Downloads'),
        path.join(process.env.USERPROFILE, 'Desktop')
      ];

      let sourceFile = null;
      for (const dir of searchPaths) {
        try {
          const files = fs.readdirSync(dir);
          const found = files.find(f => f.toLowerCase().includes(filename.toLowerCase()));
          if (found) {
            sourceFile = path.join(dir, found);
            break;
          }
        } catch (e) { }
      }

      if (!sourceFile) {
        return {
          status: 'error',
          output: `File not found: ${filename}`,
          message: `❌ Could not find: ${filename}`
        };
      }

      // Move file
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      const destFile = path.join(destPath, path.basename(sourceFile));
      fs.renameSync(sourceFile, destFile);

      return {
        status: 'success',
        output: `Moved ${path.basename(sourceFile)} to ${destination}`,
        message: `📦 Moved '${path.basename(sourceFile)}' → ${destination}`,
        type: 'file_action'
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to move file'
      };
    }
  }

  /**
   * Copy file
   */
  async copyFile(instruction) {
    try {
      console.log('[GodMode] 📋 Copying file...');

      const fs = require('fs');

      // Parse: "Copy file.txt to Desktop"
      const match = instruction.match(/copy\s+['\"]?([^'\"]+)['\"]?\s+to\s+([^\s]+)/i);
      if (!match) {
        return {
          status: 'error',
          output: 'Invalid syntax',
          message: '❌ Use: "Copy filename to Desktop/Documents"'
        };
      }

      const [, filename, destination] = match;
      const commonDirs = {
        'desktop': path.join(process.env.USERPROFILE, 'Desktop'),
        'documents': path.join(process.env.USERPROFILE, 'Documents'),
        'downloads': path.join(process.env.USERPROFILE, 'Downloads')
      };

      const destPath = commonDirs[destination.toLowerCase()] || destination;

      // Find source file
      const searchPaths = [
        process.cwd(),
        path.join(process.env.USERPROFILE, 'Downloads')
      ];

      let sourceFile = null;
      for (const dir of searchPaths) {
        try {
          const files = fs.readdirSync(dir);
          const found = files.find(f => f.toLowerCase().includes(filename.toLowerCase()));
          if (found) {
            sourceFile = path.join(dir, found);
            break;
          }
        } catch (e) { }
      }

      if (!sourceFile) {
        return {
          status: 'error',
          output: `File not found: ${filename}`,
          message: `❌ Could not find: ${filename}`
        };
      }

      // Copy file
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      const destFile = path.join(destPath, path.basename(sourceFile));
      fs.copyFileSync(sourceFile, destFile);

      return {
        status: 'success',
        output: `Copied ${path.basename(sourceFile)} to ${destination}`,
        message: `📋 Copied '${path.basename(sourceFile)}' → ${destination}`,
        type: 'file_action'
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to copy file'
      };
    }
  }

  /**
   * Delete file
   */
  async deleteFile(instruction) {
    try {
      console.log('[GodMode] 🗑️ Deleting file...');

      const fs = require('fs');

      // Extract filename
      const match = instruction.match(/delete\s+['\"]?([^'\"]+)/i);
      const filename = match ? match[1].trim() : null;

      if (!filename) {
        return {
          status: 'error',
          output: 'No filename specified',
          message: '❌ Specify file to delete: "Delete filename.txt"'
        };
      }

      // Find file
      const searchPaths = [
        process.cwd(),
        path.join(process.env.USERPROFILE, 'Desktop'),
        path.join(process.env.USERPROFILE, 'Downloads')
      ];

      let foundFile = null;
      for (const dir of searchPaths) {
        try {
          const files = fs.readdirSync(dir);
          const found = files.find(f => f.toLowerCase().includes(filename.toLowerCase()));
          if (found) {
            foundFile = path.join(dir, found);
            break;
          }
        } catch (e) { }
      }

      if (!foundFile) {
        return {
          status: 'error',
          output: `File not found: ${filename}`,
          message: `❌ Could not find: ${filename}`
        };
      }

      // Delete file
      fs.unlinkSync(foundFile);

      return {
        status: 'success',
        output: `Deleted: ${path.basename(foundFile)}`,
        message: `🗑️ Deleted: ${path.basename(foundFile)}`,
        type: 'file_action'
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to delete file'
      };
    }
  }

  /**
   * Open file manager
   */
  async openFileManager() {
    try {
      console.log('[GodMode] 📂 Opening file manager...');

      const { execSync } = require('child_process');
      execSync('start explorer', { timeout: 3000 });

      return {
        status: 'success',
        output: 'File manager opened',
        message: '📂 File Manager opened',
        type: 'file_action'
      };
    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to open file manager'
      };
    }
  }

  /**
   * Organize desktop
   */
  async organizeDesktop(instruction) {
    try {
      console.log('[GodMode] 📋 Organizing desktop...');

      const fs = require('fs');
      const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');

      if (!fs.existsSync(desktopPath)) {
        return {
          status: 'error',
          output: 'Desktop folder not found',
          message: '❌ Desktop folder not accessible'
        };
      }

      const files = fs.readdirSync(desktopPath);
      const organized = {};

      // Categorize files
      for (const file of files) {
        const ext = path.extname(file).toLowerCase() || 'folders';
        if (!organized[ext]) organized[ext] = [];
        organized[ext].push(file);
      }

      // Create folders and move files
      let moveCount = 0;
      for (const [ext, fileList] of Object.entries(organized)) {
        if (ext === 'folders') continue;

        const folderName = this.getCategoryName(ext);
        const folderPath = path.join(desktopPath, folderName);

        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath);
        }

        // Move files
        for (const file of fileList) {
          try {
            const oldPath = path.join(desktopPath, file);
            const newPath = path.join(folderPath, file);
            if (fs.statSync(oldPath).isFile()) {
              fs.renameSync(oldPath, newPath);
              moveCount++;
            }
          } catch (e) {
            // Skip errors for individual files
          }
        }
      }

      return {
        status: 'success',
        output: `Organized ${moveCount} files on desktop`,
        message: `📋 Desktop organized! ${moveCount} files sorted by type`,
        type: 'file_action'
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to organize desktop'
      };
    }
  }

  /**
   * Clean desktop
   */
  async cleanDesktop() {
    try {
      console.log('[GodMode] 🧹 Cleaning desktop...');

      const fs = require('fs');
      const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');

      const files = fs.readdirSync(desktopPath);
      let deletedCount = 0;

      // Delete temporary files
      for (const file of files) {
        const fullPath = path.join(desktopPath, file);
        if (file.startsWith('~') || file.startsWith('.') || file.includes('temp')) {
          try {
            if (fs.statSync(fullPath).isFile()) {
              fs.unlinkSync(fullPath);
              deletedCount++;
            }
          } catch (e) { }
        }
      }

      return {
        status: 'success',
        output: `Cleaned desktop - ${deletedCount} temporary files removed`,
        message: `🧹 Desktop cleaned! Removed ${deletedCount} temporary files`,
        type: 'file_action'
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to clean desktop'
      };
    }
  }

  /**
   * Create folder
   */
  async createFolder(instruction) {
    try {
      console.log('[GodMode] 📁 Creating folder...');

      const fs = require('fs');

      // Extract folder name
      const match = instruction.match(/(?:create|new)\s+(?:folder|directory)\s+['\"]?([^'\"]+)/i);
      const folderName = match ? match[1].trim() : null;

      if (!folderName) {
        return {
          status: 'error',
          output: 'No folder name specified',
          message: '❌ Specify folder name: "Create folder MyFolder"'
        };
      }

      const folderPath = path.join(process.env.USERPROFILE, 'Desktop', folderName);

      if (fs.existsSync(folderPath)) {
        return {
          status: 'error',
          output: `Folder already exists: ${folderName}`,
          message: `❌ Folder already exists: ${folderName}`
        };
      }

      fs.mkdirSync(folderPath);

      return {
        status: 'success',
        output: `Created folder: ${folderName}`,
        message: `📁 Created folder: ${folderName}`,
        type: 'file_action'
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to create folder'
      };
    }
  }

  /**
   * Rename file
   */
  async renameFile(instruction) {
    try {
      console.log('[GodMode] ✏️ Renaming file...');

      const fs = require('fs');

      // Parse: "Rename old.txt to new.txt"
      const match = instruction.match(/rename\s+['\"]?([^'\"]+)['\"]?\s+to\s+['\"]?([^'\"]+)/i);
      if (!match) {
        return {
          status: 'error',
          output: 'Invalid syntax',
          message: '❌ Use: "Rename oldname.txt to newname.txt"'
        };
      }

      const [, oldName, newName] = match;
      const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');

      const oldPath = path.join(desktopPath, oldName);
      const newPath = path.join(desktopPath, newName);

      if (!fs.existsSync(oldPath)) {
        return {
          status: 'error',
          output: `File not found: ${oldName}`,
          message: `❌ Could not find: ${oldName}`
        };
      }

      fs.renameSync(oldPath, newPath);

      return {
        status: 'success',
        output: `Renamed: ${oldName} → ${newName}`,
        message: `✏️ Renamed: ${oldName} → ${newName}`,
        type: 'file_action'
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to rename file'
      };
    }
  }

  /**
   * Close application by name
   */
  async closeApplication(instruction) {
    try {
      console.log('[GodMode] 🔴 Closing application...');

      const cmd = instruction.toLowerCase();

      // App name mapping
      const appMap = {
        'vs code': 'Code',
        'code': 'Code',
        'vscode': 'Code',
        'visual studio': 'Code',
        'chrome': 'chrome',
        'google chrome': 'chrome',
        'firefox': 'firefox',
        'edge': 'msedge',
        'notepad': 'notepad',
        'excel': 'EXCEL',
        'word': 'WINWORD',
        'outlook': 'OUTLOOK',
        'teams': 'Teams',
        'discord': 'Discord',
        'zoom': 'Zoom'
      };

      // Find matching app
      let appName = null;
      for (const [keyword, name] of Object.entries(appMap)) {
        if (cmd.includes(keyword)) {
          appName = name;
          break;
        }
      }

      if (!appName) {
        // Extract generic app name
        const match = instruction.match(/close\s+(?:app\s+)?(?:called\s+)?['\"]?([a-z0-9\s]+)/i);
        if (match) {
          appName = match[1].trim().split(/\s+/)[0];
        }
      }

      if (!appName) {
        return {
          status: 'error',
          output: 'No application name specified',
          message: '❌ Specify app name: "Close vs code" or "Close Chrome"'
        };
      }

      const { execSync } = require('child_process');

      try {
        // Try to kill by name - PowerShell method
        const psCommand = `Stop-Process -Name "${appName}" -Force -ErrorAction SilentlyContinue; if ($?) { "Closed" } else { "Not running" }`;
        const result = execSync(`powershell -Command "${psCommand}"`, {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        return {
          status: 'success',
          output: `Closed application: ${appName}`,
          message: `🔴 Closed: ${appName}`,
          type: 'window_action'
        };
      } catch (psError) {
        // Fallback: try taskkill
        try {
          execSync(`taskkill /IM ${appName}.exe /F`, {
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe']
          });

          return {
            status: 'success',
            output: `Closed application: ${appName}`,
            message: `🔴 Closed: ${appName}`,
            type: 'window_action'
          };
        } catch (tkError) {
          return {
            status: 'error',
            output: `Could not close: ${appName} (not running or access denied)`,
            message: `❌ Could not close: ${appName} - Application may not be running`,
            type: 'window_action'
          };
        }
      }

    } catch (error) {
      console.error('[GodMode] Close app error:', error.message);
      return {
        status: 'error',
        output: error.message,
        message: '❌ Failed to close application'
      };
    }
  }

  /**
   * Get category name for file extension
   */
  getCategoryName(ext) {
    const categories = {
      '.pdf': 'Documents',
      '.doc': 'Documents',
      '.docx': 'Documents',
      '.txt': 'Documents',
      '.xls': 'Documents',
      '.xlsx': 'Documents',
      '.jpg': 'Pictures',
      '.jpeg': 'Pictures',
      '.png': 'Pictures',
      '.gif': 'Pictures',
      '.bmp': 'Pictures',
      '.mp3': 'Music',
      '.wav': 'Music',
      '.flac': 'Music',
      '.m4a': 'Music',
      '.mp4': 'Videos',
      '.avi': 'Videos',
      '.mkv': 'Videos',
      '.mov': 'Videos',
      '.exe': 'Programs',
      '.zip': 'Archives',
      '.rar': 'Archives',
      '.7z': 'Archives'
    };

    return categories[ext] || `${ext.slice(1).toUpperCase()} Files`;
  }

  /**
   * Actually execute the parsed plan (REAL WORK HAPPENS HERE)
   */
  async execute(plan, userPhone = null) {
    try {
      console.log(`[GodMode] ⚙️ Executing ${plan.task_type} task...`);

      let result;

      switch (plan.task_type) {
        case 'shell':
        case 'cmd':
        case 'powershell':
          result = await this.executeShell(plan);
          break;
        case 'file':
          result = await this.executeFileOperation(plan);
          break;
        case 'app':
        case 'application':
          result = await this.launchApplication(plan);
          break;
        case 'desktop':
          result = await this.desktopAutomation(plan);
          break;
        case 'browser':
          result = await this.browserControl(plan);
          break;
        case 'media':
          result = await this.mediaControl(plan);
          break;
        case 'navigation':
          result = await this.navigationControl(plan);
          break;
        case 'whatsapp':
          result = await this.executeWhatsApp(plan, userPhone);
          break;
        case 'gemini':
          result = await this.executeGemini(plan, userPhone);
          break;
        case 'window':
          result = await this.windowManagement(plan);
          break;
        case 'process':
          result = await this.processManagement(plan);
          break;
        case 'registry':
          result = await this.registryOperation(plan);
          break;
        case 'system':
          result = await this.systemOperation(plan);
          break;
        case 'code':
          result = await this.executeCode(plan);
          break;
        case 'api':
          result = await this.executeAPI(plan);
          break;
        case 'workflow':
          result = await this.executeWorkflow(plan);
          break;
        case 'data':
          result = await this.processData(plan);
          break;
        default:
          result = {
            status: 'error',
            output: `Unknown task type: ${plan.task_type}`,
            message: 'Cannot execute unknown task type'
          };
      }

      return result;

    } catch (error) {
      console.error('[GodMode] Execution error:', error.message);
      return {
        status: 'error',
        output: error.message,
        message: `Execution failed: ${error.message}`
      };
    }
  }

  /**
   * SHELL EXECUTION - Run any PowerShell/CMD command directly
   */
  async executeShell(plan) {
    try {
      const { output: command, language = 'powershell' } = plan;

      if (!command || command.length === 0) {
        return { status: 'error', output: 'No command provided', message: 'Shell execution failed' };
      }

      console.log(`[GodMode] 💻 Executing shell command: ${command.substring(0, 100)}`);

      return await this.runCommand(command);

    } catch (error) {
      console.error('[GodMode] Shell execution error:', error.message);
      return { status: 'error', output: error.message, message: 'Shell command failed' };
    }
  }

  /**
   * FILE OPERATIONS - Copy, move, delete, organize, search
   */
  async executeFileOperation(plan) {
    try {
      const { output: command } = plan;

      if (!command || command.length === 0) {
        return { status: 'error', output: 'No file operation specified' };
      }

      console.log(`[GodMode] 📁 File operation: ${command.substring(0, 100)}`);

      // Parse and execute file operations via PowerShell
      const psCommand = this.buildFileOperationCommand(command);
      return await this.runCommand(psCommand);

    } catch (error) {
      console.error('[GodMode] File operation error:', error.message);
      return { status: 'error', output: error.message };
    }
  }

  /**
   * APPLICATION LAUNCHING
   */
  async launchApplication(plan) {
    try {
      const { output: appName } = plan;

      if (!appName || appName.length === 0) {
        return { status: 'error', output: 'No application specified' };
      }

      console.log(`[GodMode] 🚀 Launching application: ${appName}`);

      // Use PowerShell to launch application
      const psCommand = `Start-Process "${appName}" -NoNewWindow`;
      return await this.runCommand(psCommand);

    } catch (error) {
      console.error('[GodMode] Application launch error:', error.message);
      return { status: 'error', output: error.message };
    }
  }

  /**
   * DESKTOP AUTOMATION - Click, type, mouse movements
   */
  async desktopAutomation(plan) {
    try {
      const { output: action, language } = plan;

      if (!action || action.length === 0) {
        return { status: 'error', output: 'No action specified' };
      }

      console.log(`[GodMode] 🖱️ Desktop automation: ${action.substring(0, 100)}`);

      // Use AutoHotkey or direct Windows API for automation
      // For now, use PowerShell with System.Windows.Forms
      const psCommand = this.buildDesktopAutomationCommand(action);
      return await this.runCommand(psCommand);

    } catch (error) {
      console.error('[GodMode] Desktop automation error:', error.message);
      return { status: 'error', output: error.message };
    }
  }

  /**
   * BROWSER CONTROL - Navigate, click, fill forms, close
   */
  async browserControl(plan) {
    try {
      const { output: instruction } = plan;

      if (!instruction || instruction.length === 0) {
        return { status: 'error', output: 'No browser action specified' };
      }

      console.log(`[GodMode] 🌐 Browser control: ${instruction.substring(0, 100)}`);

      // Use Puppeteer or direct Selenium for browser control
      // For now, use PowerShell to control browser via COM
      const psCommand = this.buildBrowserControlCommand(instruction);
      return await this.runCommand(psCommand);

    } catch (error) {
      console.error('[GodMode] Browser control error:', error.message);
      return { status: 'error', output: error.message };
    }
  }

  /**
   * MEDIA CONTROL - Play, pause, skip, volume
   */
  async mediaControl(plan) {
    try {
      const { output: action } = plan;

      if (!action || action.length === 0) {
        return { status: 'error', output: 'No media action specified' };
      }

      console.log(`[GodMode] 🎵 Media control: ${action}`);

      const psCommand = this.buildMediaControlCommand(action);
      return await this.runCommand(psCommand);

    } catch (error) {
      console.error('[GodMode] Media control error:', error.message);
      return { status: 'error', output: error.message };
    }
  }

  /**
   * NAVIGATION CONTROL - YouTube/Video player keyboard shortcuts
   * Supports: fullscreen (F), skip forward (→), skip backward (←), skip ad, pause/play
   */
  async navigationControl(plan) {
    try {
      const { output: action } = plan;

      if (!action || action.length === 0) {
        return { status: 'error', output: 'No navigation action specified' };
      }

      console.log(`[GodMode] 🎬 Navigation control: ${action}`);

      const psCommand = this.buildNavigationCommand(action);
      return await this.runCommand(psCommand);

    } catch (error) {
      console.error('[GodMode] Navigation control error:', error.message);
      return { status: 'error', output: error.message };
    }
  }

  /**
   * WINDOW MANAGEMENT - Minimize, maximize, close, resize
   */
  async windowManagement(plan) {
    try {
      const { output: action } = plan;

      if (!action || action.length === 0) {
        return { status: 'error', output: 'No window action specified' };
      }

      console.log(`[GodMode] 🪟 Window management: ${action}`);

      const psCommand = this.buildWindowCommand(action);
      return await this.runCommand(psCommand);

    } catch (error) {
      console.error('[GodMode] Window management error:', error.message);
      return { status: 'error', output: error.message };
    }
  }

  /**
   * PROCESS MANAGEMENT - Start, stop, kill processes
   */
  async processManagement(plan) {
    try {
      const { output: action } = plan;

      if (!action || action.length === 0) {
        return { status: 'error', output: 'No process action specified' };
      }

      console.log(`[GodMode] ⚡ Process management: ${action}`);

      const psCommand = this.buildProcessCommand(action);
      return await this.runCommand(psCommand);

    } catch (error) {
      console.error('[GodMode] Process management error:', error.message);
      return { status: 'error', output: error.message };
    }
  }

  /**
   * REGISTRY OPERATIONS - Read/write Windows registry
   */
  async registryOperation(plan) {
    try {
      const { output: action } = plan;

      if (!action || action.length === 0) {
        return { status: 'error', output: 'No registry action specified' };
      }

      console.log(`[GodMode] 📝 Registry operation: ${action.substring(0, 100)}`);

      const psCommand = this.buildRegistryCommand(action);
      return await this.runCommand(psCommand);

    } catch (error) {
      console.error('[GodMode] Registry operation error:', error.message);
      return { status: 'error', output: error.message };
    }
  }

  /**
   * SYSTEM OPERATIONS - Settings, network, screenshot
   */
  async systemOperation(plan) {
    try {
      const { output: action } = plan;

      if (!action || action.length === 0) {
        return { status: 'error', output: 'No system action specified' };
      }

      console.log(`[GodMode] 🖥️ System operation: ${action.substring(0, 100)}`);

      const psCommand = this.buildSystemCommand(action);
      return await this.runCommand(psCommand);

    } catch (error) {
      console.error('[GodMode] System operation error:', error.message);
      return { status: 'error', output: error.message };
    }
  }

  /**
   * Helper: Build file operation command
   */
  buildFileOperationCommand(instruction) {
    const cmd = instruction.toLowerCase();

    if (cmd.includes('copy')) {
      const match = instruction.match(/copy\s+"?([^"]*)"?\s+to\s+"?([^"]*)"?/i);
      if (match) {
        return `Copy-Item -Path "${match[1]}" -Destination "${match[2]}" -Recurse -Force`;
      }
    }

    if (cmd.includes('move')) {
      const match = instruction.match(/move\s+"?([^"]*)"?\s+to\s+"?([^"]*)"?/i);
      if (match) {
        return `Move-Item -Path "${match[1]}" -Destination "${match[2]}" -Force`;
      }
    }

    if (cmd.includes('delete') && cmd.includes('file')) {
      const match = instruction.match(/delete\s+"?([^"]*)"?/i);
      if (match) {
        return `Remove-Item -Path "${match[1]}" -Force -Recurse`;
      }
    }

    if (cmd.includes('search') && cmd.includes('file')) {
      const match = instruction.match(/search\s+(?:file\s+)?"?([^"]*)"?/i);
      if (match) {
        return `Get-ChildItem -Path "C:\\" -Filter "*${match[1]}*" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName`;
      }
    }

    if (cmd.includes('organize') || cmd.includes('arrange')) {
      return `# Desktop organization\n$desktop = [Environment]::GetFolderPath('Desktop')\nGet-ChildItem $desktop | Group-Object Extension | ForEach-Object { New-Item -ItemType Directory -Path "$desktop/$($_.Name)" -Force; Move-Item -Path "$($_.Group.FullName)" -Destination "$desktop/$($_.Name)" -Force }`;
    }

    return instruction;
  }

  /**
   * Helper: Build desktop automation command
   */
  buildDesktopAutomationCommand(instruction) {
    return `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class User32 {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
    
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);
  }
"@

# Parse instruction and execute
${instruction}
`;
  }

  /**
   * Helper: Build browser control command
   */
  buildBrowserControlCommand(instruction) {
    return `# Browser automation - implement based on instruction`;
  }

  /**
   * Helper: Build media control command
   */
  buildMediaControlCommand(action) {
    const cmd = action.toLowerCase();

    if (cmd.includes('play') && cmd.includes('sound')) {
      return `(New-Object System.Media.SoundPlayer).PlaySync()`;
    }

    if (cmd.includes('pause')) {
      return `# Pause media: [System.Windows.Forms.SendKeys]::SendWait("%{PLAY_PAUSE}")`;
    }

    if (cmd.includes('next') || cmd.includes('skip')) {
      return `[System.Windows.Forms.SendKeys]::SendWait("^n")`;
    }

    if (cmd.includes('previous') || cmd.includes('back')) {
      return `[System.Windows.Forms.SendKeys]::SendWait("^b")`;
    }

    if (cmd.includes('volume')) {
      const level = action.match(/\d+/)?.[0] || 50;
      return `# Set volume to ${level}%`;
    }

    return action;
  }

  /**
   * Helper: Build navigation command for YouTube/video players
   * Supported keys: f (fullscreen), arrow right/left (skip), space (pause/play), s (skip ad)
   */
  buildNavigationCommand(action) {
    const cmd = action.toLowerCase().trim();

    // Helper function to create key press command using AutoHotkey (more reliable)
    const createKeyPress = (keyCode, description) => {
      // Convert special keys to AutoHotkey syntax
      const keyMap = {
        '{RIGHT}': 'Right',
        '{LEFT}': 'Left',
        '{UP}': 'Up',
        '{DOWN}': 'Down',
        ' ': 'Space',
        'f': 'f',
        'n': 'n',
        'p': 'p',
        's': 's',
        'm': 'm',
        'c': 'c',
        't': 't',
        '~': '~',
      };

      const ahkKey = keyMap[keyCode] || keyCode;

      // Create a PowerShell command that sends the key using [System.Windows.Forms.SendKeys]
      return `
\$null = Add-Type -AssemblyName System.Windows.Forms
\$wshell = New-Object -ComObject WScript.Shell
\$wshell.SendKeys('${ahkKey}')
Start-Sleep -Milliseconds 100
Write-Host "✅ ${description} sent"
`;
    };

    // FULLSCREEN TOGGLE - F key
    if (cmd.includes('fullscreen') || cmd === 'f') {
      return createKeyPress('f', 'Fullscreen toggle');
    }

    // ========== PLAYBACK NAVIGATION (Check BEFORE generic play/pause) ==========
    // PREVIOUS VIDEO/SONG - P key
    if (cmd.includes('previous') || 
        cmd.includes('play previous') ||
        cmd.includes('prev video') ||
        cmd.includes('prev song') ||
        cmd.includes('previous video') ||
        cmd.includes('previous song') ||
        cmd.includes('previous track') ||
        cmd === 'p') {
      return createKeyPress('p', 'Previous video/song');
    }

    // NEXT VIDEO/SONG - N key
    if (cmd.includes('next') || 
        cmd.includes('play next') ||
        cmd.includes('next video') ||
        cmd.includes('next song') ||
        cmd.includes('next track') ||
        cmd === 'n') {
      return createKeyPress('n', 'Next video/song');
    }

    // ========== SKIP/SEEK COMMANDS ==========
    // SKIP FORWARD 10 SECONDS - Right Arrow
    if ((cmd.includes('skip') && cmd.includes('forward')) || 
        cmd.includes('skip ahead') ||
        cmd.includes('forward 10') ||
        cmd.includes('seek forward')) {
      return createKeyPress('{RIGHT}', 'Skip 10 seconds forward');
    }

    // SKIP BACKWARD 10 SECONDS - Left Arrow
    if ((cmd.includes('skip') && cmd.includes('backward')) || 
        (cmd.includes('skip') && cmd.includes('back')) ||
        cmd.includes('skip back') ||
        cmd.includes('backward 10') ||
        cmd.includes('seek backward')) {
      return createKeyPress('{LEFT}', 'Skip 10 seconds backward');
    }

    // SKIP AD / SKIP CONTENT - S key
    if (cmd.includes('skip') && cmd.includes('ad')) {
      return createKeyPress('s', 'Skip advertisement');
    }

    // ========== PLAYBACK CONTROLS ==========
    // PLAY/PAUSE - Space bar (generic, checked AFTER navigation)
    if (cmd.includes('pause') || (cmd.includes('play') && !cmd.includes('skip')) || cmd === 'space') {
      return createKeyPress(' ', 'Play/Pause toggle');
    }

    // VOLUME UP - Up Arrow
    if (cmd.includes('volume') && cmd.includes('up')) {
      return createKeyPress('{UP}', 'Volume increase');
    }

    // VOLUME DOWN - Down Arrow
    if (cmd.includes('volume') && cmd.includes('down')) {
      return createKeyPress('{DOWN}', 'Volume decrease');
    }

    // MUTE/UNMUTE - M key
    if (cmd.includes('mute')) {
      return createKeyPress('m', 'Mute/Unmute toggle');
    }

    // CAPTION TOGGLE - C key
    if (cmd.includes('caption') || cmd.includes('subtitle')) {
      return createKeyPress('c', 'Caption toggle');
    }

    // THEATER MODE - T key
    if (cmd.includes('theater')) {
      return createKeyPress('t', 'Theater mode toggle');
    }

    // SEEK TO TIME - J key (backward 10 seconds alternative)
    if (cmd.includes('seek')) {
      return createKeyPress('j', 'Seek backward');
    }

    // EXTENDED STATS - ~ key (tilde)
    if (cmd.includes('stats')) {
      return createKeyPress('~', 'Extended stats');
    }

    // Handle "press X" or "press X key" pattern
    const pressMatch = cmd.match(/press\s+([a-z0-9])\s*(?:key)?/i);
    if (pressMatch) {
      const key = pressMatch[1].toLowerCase();
      return createKeyPress(key, `Key '${key}' pressed`);
    }

    // Default: Try to send as key press if it's a single letter
    if (cmd.length === 1 && /[a-z0-9]/.test(cmd)) {
      return createKeyPress(cmd, `Key '${cmd}' pressed`);
    }

    return `Write-Host "❌ Unknown navigation command: ${action}"`;
  }

  /**
   * Helper: Build window management command
   */
  buildWindowCommand(action) {
    const cmd = action.toLowerCase();

    if (cmd.includes('minimize')) {
      return `Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | ForEach-Object { [System.Windows.Forms.SendKeys]::SendWait("%d") }`;
    }

    if (cmd.includes('maximize')) {
      return `[System.Windows.Forms.SendKeys]::SendWait("%x")`;
    }

    if (cmd.includes('close')) {
      return `[System.Windows.Forms.SendKeys]::SendWait("%{F4}")`;
    }

    return action;
  }

  /**
   * Helper: Build process command
   */
  buildProcessCommand(action) {
    const cmd = action.toLowerCase();

    if (cmd.includes('start') || cmd.includes('run')) {
      const match = action.match(/(?:start|run)\s+(?:process\s+)?"?([^"]*)"?/i);
      if (match) {
        return `Start-Process "${match[1]}"`;
      }
    }

    if (cmd.includes('stop') || cmd.includes('kill')) {
      const match = action.match(/(?:stop|kill)\s+(?:process\s+)?"?([^"]*)"?/i);
      if (match) {
        return `Stop-Process -Name "${match[1]}" -Force -ErrorAction SilentlyContinue`;
      }
    }

    if (cmd.includes('list') || cmd.includes('get')) {
      return `Get-Process | Select-Object Name, Id, @{Name='Memory (MB)'; Expression={[math]::Round($_.WorkingSet/1MB, 2)}} | Format-Table`;
    }

    return action;
  }

  /**
   * Helper: Build registry command
   */
  buildRegistryCommand(action) {
    return `# Registry operation: ${action}`;
  }

  /**
   * Helper: Build system command
   */
  buildSystemCommand(action) {
    const cmd = action.toLowerCase();

    if (cmd.includes('screenshot') || cmd.includes('screen capture')) {
      return `
[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
\$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
\$bitmap = New-Object System.Drawing.Bitmap(\$screen.Width, \$screen.Height)
\$graphics = [System.Drawing.Graphics]::FromImage(\$bitmap)
\$graphics.CopyFromScreen(\$screen.Location, [System.Drawing.Point]::Empty, \$screen.Size)
\$bitmap.Save("$env:USERPROFILE\\Desktop\\screenshot_\$(Get-Date -Format 'yyyyMMdd_HHmmss').png")
\$graphics.Dispose()
\$bitmap.Dispose()
Write-Host "Screenshot saved"
`;
    }

    if (cmd.includes('ip') || cmd.includes('network')) {
      return `Get-NetIPAddress -AddressFamily IPv4 | Format-Table`;
    }

    if (cmd.includes('battery') || cmd.includes('power')) {
      return `Get-WmiObject Win32_Battery | Select-Object EstimatedChargeRemaining, Status`;
    }

    if (cmd.includes('wifi') || cmd.includes('network')) {
      return `netsh wlan show interfaces`;
    }

    return action;
  }

  /**
   * EXECUTE CODE - Python, JavaScript, Bash (NO SANDBOXING - DIRECT EXECUTION)
   */
  async executeCode(plan) {
    try {
      const { language, output: code } = plan;

      if (!code || code.length === 0) {
        return {
          status: 'error',
          output: 'No code provided',
          message: 'Code execution failed'
        };
      }

      console.log(`[GodMode] 💻 Executing ${language} code directly...`);

      switch (language.toLowerCase()) {
        case 'python':
        case 'py':
          // Execute Python directly
          const pythonFile = path.join(process.cwd(), `temp_${Date.now()}.py`);
          await fs.writeFile(pythonFile, code);
          return await this.runCommand(`python "${pythonFile}"`);

        case 'javascript':
        case 'js':
          // Execute JavaScript directly with eval - NO RESTRICTIONS
          return await this.executeJavaScriptDirect(code);

        case 'powershell':
        case 'ps1':
          // Execute PowerShell directly
          return await this.runCommand(code);

        case 'bash':
        case 'bash':
        case 'sh':
          // Execute Bash directly
          return await this.runCommand(code);

        case 'cmd':
        case 'batch':
          // Execute CMD batch directly
          return await this.runCommand(code);

        case 'sql':
          return {
            status: 'ready',
            output: code,
            message: 'SQL ready to execute - paste in your database client',
            type: 'sql'
          };

        default:
          return await this.runCommand(code);
      }

    } catch (error) {
      console.error('[GodMode] Code execution error:', error.message);
      return {
        status: 'error',
        output: error.message,
        message: 'Code execution failed'
      };
    }
  }

  /**
   * Execute JavaScript directly without any sandboxing
   */
  async executeJavaScriptDirect(code) {
    return new Promise((resolve) => {
      try {
        console.log('[GodMode] Running JavaScript directly...');

        // Direct execution - NO SANDBOX
        const result = eval(code);

        resolve({
          status: 'success',
          output: String(result),
          message: 'JavaScript executed successfully',
          type: 'javascript_execution'
        });

      } catch (error) {
        console.error('[GodMode] JS Error:', error.message);
        resolve({
          status: 'error',
          output: error.message,
          message: 'JavaScript execution failed'
        });
      }
    });
  }

  /**
   * Execute API calls (REST, GraphQL, etc.)
   */
  async executeAPI(plan) {
    try {
      console.log('[GodMode] 📡 Making API call...');

      const { output: apiCommand, language, dependencies } = plan;

      if (!apiCommand) {
        return {
          status: 'error',
          output: 'No API command provided',
          message: 'API call failed'
        };
      }

      // Parse API call (could be curl, fetch, or structured)
      let response;

      if (language === 'curl' || apiCommand.includes('curl')) {
        // Parse curl and execute as fetch
        response = await this.executeCurl(apiCommand);
      } else {
        // Try to parse as JSON fetch request
        try {
          const request = typeof apiCommand === 'string' ? JSON.parse(apiCommand) : apiCommand;
          response = await this.executeFetch(request);
        } catch (e) {
          // Fall back to just returning the API command
          return {
            status: 'success',
            output: apiCommand,
            message: 'API call formatted - execute with your HTTP client',
            type: 'api_specification'
          };
        }
      }

      return {
        status: 'success',
        output: JSON.stringify(response, null, 2),
        message: `API call executed successfully`,
        statusCode: response.status,
        type: 'api_response'
      };

    } catch (error) {
      // Check for rate limit
      if (error.message.includes('429') || error.message.includes('rate')) {
        return {
          status: 'rate_limited',
          output: error.message,
          retryAfter: 2,
          message: 'API rate limited - will retry'
        };
      }

      console.error('[GodMode] API execution error:', error.message);
      return {
        status: 'error',
        output: error.message,
        message: 'API call execution failed'
      };
    }
  }

  /**
   * Execute multi-step workflows
   */
  async executeWorkflow(plan) {
    try {
      console.log('[GodMode] 🔄 Executing workflow...');

      const steps = plan.output;
      if (!Array.isArray(steps) || steps.length === 0) {
        return {
          status: 'error',
          output: 'No workflow steps provided',
          message: 'Workflow execution failed'
        };
      }

      const results = [];
      let workflowContext = {};

      for (const step of steps) {
        console.log(`[GodMode] Step: ${step.action}`);

        // Execute step
        let stepResult;

        if (step.type === 'code' || step.command?.includes('python') || step.command?.includes('node')) {
          stepResult = await this.runCommand(step.command || step.action);
        } else if (step.type === 'api') {
          stepResult = await this.executeFetch(step.request || {});
        } else {
          stepResult = { status: 'completed', output: step.action };
        }

        results.push({
          step: step.step || steps.indexOf(step) + 1,
          action: step.action,
          status: stepResult.status || 'completed',
          result: stepResult
        });

        workflowContext = { ...workflowContext, ...stepResult };
      }

      return {
        status: results.every(r => r.status !== 'error') ? 'success' : 'partial',
        output: JSON.stringify(results, null, 2),
        message: `Workflow executed: ${results.length} steps completed`,
        stepsCompleted: results.length,
        type: 'workflow_execution'
      };

    } catch (error) {
      console.error('[GodMode] Workflow execution error:', error.message);
      return {
        status: 'error',
        output: error.message,
        message: 'Workflow execution failed'
      };
    }
  }

  /**
   * Process data transformations
   */
  async processData(plan) {
    try {
      console.log('[GodMode] 📊 Processing data...');

      const { output: code, language } = plan;

      if (!code) {
        return {
          status: 'error',
          output: 'No data processing code provided',
          message: 'Data processing failed'
        };
      }

      if (language === 'python') {
        const pythonFile = path.join(process.cwd(), `temp_data_${Date.now()}.py`);
        await fs.writeFile(pythonFile, code);
        return await this.runCommand(`python "${pythonFile}"`);
      }

      if (language === 'javascript') {
        return await this.executeJavaScriptDirect(code);
      }

      return {
        status: 'success',
        output: code,
        message: 'Data processing code ready for execution',
        language
      };

    } catch (error) {
      console.error('[GodMode] Data processing error:', error.message);
      return {
        status: 'error',
        output: error.message,
        message: 'Data processing failed'
      };
    }
  }

  /**
   * Run command in subprocess
   */
  async runCommand(command) {
    return new Promise((resolve) => {
      try {
        const { execSync } = require('child_process');
        console.log(`[GodMode] Running: ${command}`);

        const output = execSync(command, {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000
        });

        console.log('[GodMode] Command completed');

        resolve({
          status: 'success',
          output: output.substring(0, 2000),
          message: 'Command executed successfully',
          type: 'command_output'
        });

      } catch (error) {
        console.error('[GodMode] Command failed:', error.message);
        resolve({
          status: 'error',
          output: error.message,
          message: 'Command execution failed'
        });
      }
    });
  }

  /**
   * Execute curl command as HTTP request
   */
  async executeCurl(curlCommand) {
    try {
      console.log('[GodMode] Executing curl...');

      // Parse curl command
      const urlMatch = curlCommand.match(/https?:\/\/[^\s]+/);
      if (!urlMatch) throw new Error('No URL found in curl command');

      const url = urlMatch[0];
      const isPost = curlCommand.includes('-X POST');
      const isDelete = curlCommand.includes('-X DELETE');
      const isPut = curlCommand.includes('-X PUT');

      const options = {
        method: isDelete ? 'DELETE' : isPut ? 'PUT' : isPost ? 'POST' : 'GET'
      };

      // Extract headers
      const headerMatches = curlCommand.matchAll(/-H ['"]([^'"]+)['"]/g);
      for (const match of headerMatches) {
        const [key, value] = match[1].split(':').map(s => s.trim());
        if (!options.headers) options.headers = {};
        options.headers[key] = value;
      }

      // Extract body
      const bodyMatch = curlCommand.match(/-d ['"]([^'"]+)['"]/);
      if (bodyMatch) {
        options.body = bodyMatch[1];
      }

      return await this.executeFetch(url, options);

    } catch (error) {
      throw new Error(`Curl execution failed: ${error.message}`);
    }
  }

  /**
   * Execute HTTP fetch request
   */
  async executeFetch(url, options = {}) {
    try {
      const fetch = require('node-fetch');

      console.log(`[GodMode] Fetching: ${url}`);

      const response = await fetch(url, {
        timeout: 10000,
        ...options
      });

      const text = await response.text();

      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
        body: text.substring(0, 1000)
      };

    } catch (error) {
      throw new Error(`Fetch failed: ${error.message}`);
    }
  }

  /**
   * Set rate limit state
   */
  setRateLimit(retryAfter = 2) {
    console.log(`[GodMode] ⏱️ Rate limit detected - retry in ${retryAfter}s`);
    this.rateLimitState = {
      isLimited: true,
      retryAfter,
      timestamp: Date.now()
    };

    // Auto-reset after retryAfter seconds
    setTimeout(() => {
      this.rateLimitState.isLimited = false;
      console.log('[GodMode] ✅ Rate limit cleared - processing queue...');
      this.processQueue();
    }, retryAfter * 1000);
  }

  /**
   * Process queued instructions
   */
  async processQueue(userPhone = null) {
    if (this.isProcessingQueue || this.instructionQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    console.log(`[GodMode] 📮 Processing ${this.instructionQueue.length} queued instructions...`);

    while (this.instructionQueue.length > 0) {
      const { instruction, context } = this.instructionQueue.shift();

      console.log(`[GodMode] 🔄 Processing queued: "${instruction}"`);

      await this.executeInstruction(instruction, context, userPhone);

      // Check rate limit again
      if (this.rateLimitState.isLimited) {
        console.log('[GodMode] Rate limited again - stopping queue processing');
        break;
      }

      // Small delay between queue items
      await new Promise(r => setTimeout(r, 500));
    }

    this.isProcessingQueue = false;
    console.log('[GodMode] ✅ Queue processed');
  }

  /**
   * Format execution result for WhatsApp display - CONCISE style
   */
  formatForWhatsApp(result) {
    try {
      // Handle execution result
      if (result.status) {
        if (result.status === 'queued') {
          return `⏳ Queued - will execute shortly`;
        }

        if (result.status === 'error') {
          return `❌ ${result.message}\n\n💡 ${result.fallback || 'Try rephrasing'}`;
        }

        if (result.status === 'success' || result.status === 'partial') {
          // Concise success format
          return `Done boss ✅\n${result.message}`;
        }
      }

      // Fallback for parsed plan (old format)
      if (result.task_type === 'error') {
        return `❌ ${result.output}\n\n💡 ${result.fallback}`;
      }

      // For code/plan output, keep it brief
      return `Done boss ✅\n${result.notes || result.output?.substring(0, 200) || 'Executed'}`;

    } catch (error) {
      console.error('[GodMode] Format error:', error.message);
      return `⚠️ Error: ${error.message}`;
    }
  }

  /**
   * Log execution for audit trail and history
   */
  async logExecution(execution) {
    try {
      this.executionHistory.push({
        ...execution,
        id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      });

      // Keep only recent history
      if (this.executionHistory.length > this.maxHistorySize) {
        this.executionHistory = this.executionHistory.slice(-this.maxHistorySize);
      }

      // Optionally save to file
      try {
        const logFile = path.join(process.cwd(), 'data', 'god-mode-executions.json');
        await fs.writeFile(logFile, JSON.stringify(this.executionHistory, null, 2));
      } catch (e) {
        // Non-critical error
      }

    } catch (error) {
      console.warn('[GodMode] Logging error (non-critical):', error.message);
    }
  }

  /**
   * Get cached last successful engine
   */
  getLastSuccessfulEngine() {
    return this.lastSuccessfulEngine;
  }

  /**
   * Set last successful engine
   */
  setLastSuccessfulEngine(engine) {
    console.log(`[GodMode] 💾 Caching successful engine: ${engine}`);
    this.lastSuccessfulEngine = engine;
  }

  /**
   * Get execution history
   */
  getHistory(limit = 10) {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Get queue status
   */
  /**
   * Execute WhatsApp operations (send message/file)
   */
  async executeWhatsApp(plan, userPhone) {
    try {
      console.log('[GodMode] 📱 Executing WhatsApp task:', plan.output);

      if (!this.whatsappBot) {
        return {
          status: 'error',
          output: 'WhatsApp Bot instance not available in executor.',
          message: '❌ Cannot send WhatsApp message (Bot instance missing)'
        };
      }

      const targetPhone = userPhone;
      if (!targetPhone) {
        return {
          status: 'error',
          output: 'No target phone number provided in context.',
          message: '❌ Cannot send WhatsApp message (Unknown recipient)'
        };
      }

      // Check if output is a file path
      const fs = require('fs');
      const output = plan.output.trim();
      let isFile = false;

      // Simple heuristic: if it exists, send as file
      if (fs.existsSync(output)) {
        isFile = true;
      }

      if (isFile) {
        const { MessageMedia } = require('whatsapp-web.js');
        const media = MessageMedia.fromFilePath(output);
        await this.whatsappBot.client.sendMessage(targetPhone + '@c.us', media);
        return {
          status: 'success',
          output: `Sent file: ${output}`,
          message: '📁 File sent to WhatsApp'
        };
      } else {
        // Treat as text message
        await this.whatsappBot.client.sendMessage(targetPhone + '@c.us', output);
        return {
          status: 'success',
          output: `Sent message: ${output}`,
          message: '💬 Message sent to WhatsApp'
        };
      }

    } catch (error) {
      console.error('[GodMode] WhatsApp Execution Error:', error);
      return {
        status: 'error',
        output: error.message,
        message: `❌ WhatsApp send failed: ${error.message}`
      };
    }
  }

  /**
   * Execute Gemini specific tasks
   */
  async executeGemini(plan, userPhone) {
    try {
      console.log('[GodMode] 🤖 Executing Gemini task:', plan.output);

      // Ensure browser is open
      if (!this.godMode.browser) {
        await this.openBrowser("open chrome", userPhone);
      }

      const page = this.godMode.activePage;
      if (!page) throw new Error("No active browser page");

      // Navigate to Gemini
      await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });

      // Check for login redirect
      if (page.url().includes('accounts.google.com')) {
        return {
          status: 'error',
          output: 'User needs to login to Gemini',
          message: '⚠️ Please login to Google/Gemini in the browser window first.'
        };
      }

      // Wait for input
      // Multiple selectors to try
      const inputSelectors = [
        'div[contenteditable="true"]',
        'textarea[aria-label="Enter a prompt"]',
        'rich-textareaQuery', // partial class match logic needed?
        '.ql-editor'
      ];

      let inputFound = false;
      for (const sel of inputSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 2000 });
          await page.click(sel);
          await page.type(sel, plan.output, { delay: 10 }); // Type slowly
          inputFound = true;
          break;
        } catch (e) {
          // Try next
        }
      }

      if (!inputFound) {
        // Fallback: Type anyway if focused? Or click generic center?
        // Try searching for specific text area by JS
        const success = await page.evaluate((text) => {
          const el = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
          if (el) {
            el.focus();
            // ExecCommand insertText is reliable for contenteditable
            document.execCommand('insertText', false, text);
            return true;
          }
          return false;
        }, plan.output);

        if (!success) throw new Error("Could not find Gemini input box");
      }

      // Click Send
      await page.keyboard.press('Enter');

      console.log('[GodMode] ⏳ Waiting for Gemini generation...');
      await new Promise(r => setTimeout(r, 15000)); // Wait 15s for generation

      return {
        status: 'success',
        output: `Sent to Gemini: ${plan.output}`,
        message: '🤖 Sent prompt to Gemini'
      };

    } catch (error) {
      return {
        status: 'error',
        output: error.message,
        message: `❌ Gemini task failed: ${error.message}`
      };
    }
  }

  getQueueStatus() {
    return {
      queueLength: this.instructionQueue.length,
      rateLimited: this.rateLimitState.isLimited,
      retryAfter: this.rateLimitState.retryAfter,
      isProcessing: this.isProcessingQueue
    };
  }
}

module.exports = GodModeExecutor;
