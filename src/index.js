const WhatsAppBot = require('./whatsappClient');

// Global reference for IPC
let activeBot = null;

async function main() {
  let retryCount = 0;
  const maxRetries = 5;

  while (retryCount < maxRetries) {
    const bot = new WhatsAppBot();
    activeBot = bot; // Save reference

    // Handle graceful shutdown
    const handleShutdown = async () => {
      console.log('\n\n👋 Shutting down bot...');
      await bot.stop();
      process.exit(0);
    };

    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);

    // Listen for check-unread command
    process.on('message', async (msg) => {
      if (msg.type === 'check-unread') {
        if (bot) {
          await bot.checkUnreadMessages();
        }
      } else if (msg.type === 'start-outreach') {
        if (bot) {
          console.log(`[IPC] Received start-outreach command for ${msg.numbers.length} numbers`);
          const results = await bot.startOutreach(msg.numbers);
          if (process.send) {
            process.send({ type: 'outreach-results', results });
          }
        }
      } else if (msg.type === 'get-analytics') {
        if (bot) {
          await bot.exportAnalytics();
        }
      } else if (msg.type === 'logout') {
        if (bot) {
          console.log('[IPC] Received logout command');
          await bot.logout();
          process.exit(0); // Exit process after logout to ensure clean restart
        }
      }
    });

    // Start the bot with timeout handling
    try {
      if (retryCount === 0) {
        console.log('🚀 Starting WhatsApp AI Bot...\n');
      } else {
        console.log(`\n🔄 Retry attempt ${retryCount}/${maxRetries - 1}...\n`);
      }

      await bot.start();
      console.log('✅ Bot process initialized and running!');
      console.log('🤖 KARTA AI MODE: Active (Gemini Flash)');

      // Keep the process alive
      await new Promise(() => { });
      break;
    } catch (error) {
      retryCount++;
      if (error.message === 'Initialization timeout') {
        console.log('\n⏱️  Initialization timed out (QR may have expired).');
        if (retryCount < maxRetries) {
          console.log(`Retrying... (${retryCount}/${maxRetries - 1})`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
          continue;
        } else {
          console.log('\n❌ Max retries reached. Please run: npm start');
          process.exit(1);
        }
      } else {
        console.error('Error starting bot:', error.message);
        if (retryCount < maxRetries) {
          console.log(`Retrying... (${retryCount}/${maxRetries - 1})`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        } else {
          process.exit(1);
        }
      }
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
