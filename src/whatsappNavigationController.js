/**
 * WHATSAPP MOBILE SHORTCUTS
 * Mobile-friendly keyboard shortcuts for god mode navigation
 * Users can send text commands via WhatsApp
 */

const GodModeExecutor = require('./godModeExecutor');

class WhatsAppNavigationController {
  constructor(whatsappBot = null) {
    this.executor = new GodModeExecutor(null, whatsappBot);
    this.whatsappBot = whatsappBot;
    
    // Shortcut aliases for mobile
    this.shortcuts = {
      // MEDIA NAVIGATION
      'ff': { cmd: 'fullscreen', label: '🎬 Fullscreen' },
      'f': { cmd: 'fullscreen', label: '🎬 Fullscreen' },
      'n': { cmd: 'next video', label: '⏭️ Next Video' },
      'next': { cmd: 'next video', label: '⏭️ Next Video' },
      'p': { cmd: 'previous video', label: '⏮️ Previous Video' },
      'prev': { cmd: 'previous video', label: '⏮️ Previous Video' },
      
      // SKIP CONTROLS
      'sf': { cmd: 'skip forward', label: '⏩ Skip Forward 10s' },
      'skip': { cmd: 'skip forward', label: '⏩ Skip Forward 10s' },
      'sb': { cmd: 'skip backward', label: '⏪ Skip Backward 10s' },
      'back': { cmd: 'skip backward', label: '⏪ Skip Backward 10s' },
      'ad': { cmd: 'skip ad', label: '⏭️ Skip Ad' },
      
      // PLAYBACK CONTROLS
      'pp': { cmd: 'pause', label: '⏸️ Play/Pause' },
      'pause': { cmd: 'pause', label: '⏸️ Play/Pause' },
      'play': { cmd: 'play', label: '▶️ Play' },
      
      // VOLUME CONTROLS
      'vu': { cmd: 'volume up', label: '🔊 Volume Up' },
      'vd': { cmd: 'volume down', label: '🔉 Volume Down' },
      'mute': { cmd: 'mute', label: '🔇 Mute' },
      
      // ADVANCED FEATURES
      'cc': { cmd: 'captions', label: '📝 Captions' },
      'cap': { cmd: 'captions', label: '📝 Captions' },
      'tm': { cmd: 'theater mode', label: '🎭 Theater Mode' },
      'theater': { cmd: 'theater mode', label: '🎭 Theater Mode' },
      
      // HELP
      'help': { cmd: 'help', label: '📖 Show Help' },
      '?': { cmd: 'help', label: '📖 Show Help' },
    };

    // Natural language variations
    this.naturalLanguage = {
      fullscreen: ['fullscreen', 'full screen', 'fs', 'press f'],
      next: ['next', 'next video', 'next song', 'play next', 'skip to next'],
      previous: ['previous', 'prev', 'previous video', 'previous song', 'play previous', 'go back'],
      skip_forward: ['skip forward', 'skip ahead', 'forward', 'skip 10'],
      skip_backward: ['skip backward', 'skip back', 'backward', 'back'],
      skip_ad: ['skip ad', 'skip ads', 'skip advertisement'],
      pause: ['pause', 'play pause', 'pp', 'stop'],
      play: ['play', 'resume', 'start'],
      volume_up: ['volume up', 'louder', 'vol up', 'vu'],
      volume_down: ['volume down', 'quieter', 'vol down', 'vd'],
      mute: ['mute', 'unmute', 'silent'],
      captions: ['captions', 'subtitles', 'cc', 'subs'],
      theater: ['theater mode', 'theater', 'tm', 'full theater'],
    };
  }

  /**
   * Process WhatsApp message with navigation command
   */
  async processCommand(message, userPhone = null) {
    const cmd = message.toLowerCase().trim();
    
    console.log(`[WhatsApp Navigation] Received: "${message}"`);

    // Check direct shortcuts
    if (this.shortcuts[cmd]) {
      const shortcut = this.shortcuts[cmd];
      if (shortcut.cmd === 'help') {
        return this.getPrintableHelp();
      }
      return await this.executeNavigation(shortcut.cmd, shortcut.label, userPhone);
    }

    // Check natural language variations
    for (const [action, variations] of Object.entries(this.naturalLanguage)) {
      if (variations.includes(cmd)) {
        const shortcut = this.findShortcutByAction(action);
        if (shortcut) {
          return await this.executeNavigation(shortcut.cmd, shortcut.label, userPhone);
        }
      }
    }

    // If not matched, try full instruction parsing
    return await this.executeNavigation(message, null, userPhone);
  }

  /**
   * Find shortcut by action name
   */
  findShortcutByAction(action) {
    const actionMap = {
      fullscreen: 'ff',
      next: 'n',
      previous: 'p',
      skip_forward: 'sf',
      skip_backward: 'sb',
      skip_ad: 'ad',
      pause: 'pp',
      play: 'play',
      volume_up: 'vu',
      volume_down: 'vd',
      mute: 'mute',
      captions: 'cc',
      theater: 'tm',
    };
    
    const key = actionMap[action];
    return key ? this.shortcuts[key] : null;
  }

  /**
   * Execute navigation command
   */
  async executeNavigation(cmd, label = null, userPhone = null) {
    try {
      const result = await this.executor.executeInstruction(cmd, '', userPhone);
      
      const labelText = label ? `${label}\n\n` : '';
      const successMsg = `${labelText}✅ Command executed successfully!\n\nYou can send:\n${this.getQuickHelp()}`;
      
      return {
        status: 'success',
        message: successMsg,
        command: cmd,
        result: result
      };
    } catch (error) {
      return {
        status: 'error',
        message: `❌ Error executing command: ${error.message}\n\nTry: "help" or "?"`,
        error: error.message
      };
    }
  }

  /**
   * Get printable help text
   */
  getPrintableHelp() {
    return {
      status: 'help',
      message: `
📱 *NAVIGATION SHORTCUTS* - Send any of these commands:

🎬 *FULLSCREEN*
• f, ff, fullscreen

⏯️ *PLAYBACK*
• n, next → Next video/song
• p, prev → Previous video/song
• pp, pause → Play/Pause
• play → Resume

⏩ *SEEKING*
• sf, skip → Skip forward 10s
• sb, back → Skip backward 10s
• ad → Skip advertisement

🔊 *VOLUME*
• vu → Volume up
• vd → Volume down
• mute → Mute/Unmute

📝 *SPECIAL*
• cc, cap → Captions/Subtitles
• tm, theater → Theater mode

💬 *Examples:*
Just type: "next" or "skip forward" or "pp"
Or say: "next video", "skip ad", "fullscreen"

Send "help" or "?" anytime to see this menu.
      `.trim()
    };
  }

  /**
   * Get quick help text (short version)
   */
  getQuickHelp() {
    return `
*Quick Commands:*
f/ff - Fullscreen
n - Next
p - Prev
sf - Skip fwd
sb - Skip back
ad - Skip ads
pp - Play/Pause
vu/vd - Volume
mute - Mute
cc - Captions
tm - Theater mode

📖 Type "help" for full list
    `.trim();
  }

  /**
   * Get command shortcut menu (as WhatsApp button list)
   */
  getButtonMenu() {
    return `
🎬 *WHATSAPP NAVIGATION MENU*

Choose a command:

*Playback:*
1️⃣ Fullscreen (f)
2️⃣ Next Video (n)
3️⃣ Previous (p)
4️⃣ Play/Pause (pp)

*Seeking:*
5️⃣ Skip Forward (sf)
6️⃣ Skip Backward (sb)
7️⃣ Skip Ad (ad)

*Audio:*
8️⃣ Volume Up (vu)
9️⃣ Volume Down (vd)
0️⃣ Mute (mute)

*Special:*
🔤 Captions (cc)
🎭 Theater (tm)

Just send the shortcut or full command!
    `.trim();
  }

  /**
   * Parse numeric menu selection
   */
  parseMenuSelection(selection) {
    const menuMap = {
      '1': { cmd: 'fullscreen', label: '🎬 Fullscreen' },
      '2': { cmd: 'next video', label: '⏭️ Next Video' },
      '3': { cmd: 'previous video', label: '⏮️ Previous Video' },
      '4': { cmd: 'pause', label: '⏸️ Play/Pause' },
      '5': { cmd: 'skip forward', label: '⏩ Skip Forward' },
      '6': { cmd: 'skip backward', label: '⏪ Skip Backward' },
      '7': { cmd: 'skip ad', label: '⏭️ Skip Ad' },
      '8': { cmd: 'volume up', label: '🔊 Volume Up' },
      '9': { cmd: 'volume down', label: '🔉 Volume Down' },
      '0': { cmd: 'mute', label: '🔇 Mute' },
      'cc': { cmd: 'captions', label: '📝 Captions' },
      'tm': { cmd: 'theater mode', label: '🎭 Theater Mode' },
    };
    
    return menuMap[selection];
  }

  /**
   * Get all available shortcuts as formatted text
   */
  getAllShortcuts() {
    let text = '📋 *ALL AVAILABLE SHORTCUTS*\n\n';
    
    for (const [key, value] of Object.entries(this.shortcuts)) {
      if (value.cmd !== 'help') {
        text += `*${key}* - ${value.label}\n`;
      }
    }
    
    return text;
  }
}

module.exports = WhatsAppNavigationController;
