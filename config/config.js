require('dotenv').config();

module.exports = {
  ai: {
    provider: process.env.AI_PROVIDER || 'openai',
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 500,
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      apiKeys: (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').filter(k => k.trim()),
      model: 'gemini-2.0-flash',
      temperature: 0.7,
    },
    bytez: {
      apiKey: process.env.BYTEZ_API_KEY,
      model: 'inference-net/Schematron-3B',
    },
    openRouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
      model: 'stepfun/step-3.5-flash:free',
    },
    openRouterBackup: {
      apiKey: process.env.OPENROUTER_BACKUP_API_KEY,
      // List of models to try in order if one fails
      models: [
        'arcee-ai/trinity-large-preview:free',
        'deepseek/deepseek-r1:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'openrouter/free',
      ],
    },

  },
  bot: {
    prefix: process.env.BOT_PREFIX || '',
    autoReplyEnabled: process.env.AUTO_REPLY_ENABLED === 'true',
    responseTimeout: parseInt(process.env.RESPONSE_TIMEOUT) || 30000,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
