# 🤖 WhatsApp AI Bot

An intelligent WhatsApp bot powered by OpenRouter (or Google Gemini/OpenAI) that responds to messages automatically with a custom persona.

## ✨ Features

- 🤖 AI-powered replies (OpenRouter / Google Gemini / OpenAI)
- 🎙️ Voice Note support (transcription + audio replies)
- 📊 Web-based Control Panel dashboard
- 📢 Mass Outreach campaigns
- 🧠 Self-learning conversation memory
- 🔄 Auto-restart & retry logic

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js 18+
- Google Chrome installed
- A WhatsApp account (phone number)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/ajayadhungana5-web/whatsapp-ai-bot.git
cd whatsapp-ai-bot

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 4. Start the control panel + bot
npm run server
# Open http://localhost:3001 in your browser
# Click "Start Bot" and scan the QR code with WhatsApp
```

## 🌐 Cloud Deployment (Render.com)

This bot is deployed on [Render.com](https://render.com) — a free cloud platform that supports persistent Node.js processes.

### Deploy Steps

1. Fork this repository
2. Create a free account at [render.com](https://render.com)
3. Click **"New Web Service"** → connect your GitHub repo
4. Render will auto-detect `render.yaml` and configure everything
5. Add your secret environment variables in the Render dashboard:
   - `OPENROUTER_API_KEY` — your OpenRouter API key
   - `AI_PROVIDER` — set to `openrouter`
   - *(Optional)* `GEMINI_API_KEY` — if using Gemini
6. Click **Deploy**
7. Visit the Render URL → click **"Start Bot"** → scan the QR code

> **Note:** Render free tier may sleep after 15 min of inactivity. Upgrade to Starter ($7/mo) for 24/7 uptime.

## ⚙️ Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AI_PROVIDER` | `openrouter`, `gemini` or `openai` | Yes |
| `OPENROUTER_API_KEY` | OpenRouter API key | If using OpenRouter |
| `GEMINI_API_KEY` | Google Gemini API key | If using Gemini |
| `AUTO_REPLY_ENABLED` | Enable auto-replies (`true`/`false`) | No |
| `RESPONSE_TIMEOUT` | AI timeout in ms | No |
| `LOG_LEVEL` | Logging level (`info`/`debug`) | No |

## 📁 Project Structure

```
src/
├── index.js          — Bot entry point
├── server.js         — Control panel web server
├── whatsappClient.js — WhatsApp connection & message handling
├── aiProvider.js     — AI response generation (Gemini/OpenAI)
├── ttsProvider.js    — Text-to-speech for voice replies
├── transcriptionProvider.js — Speech-to-text for voice notes
└── ...
public/               — Control panel web UI
config/               — Bot configuration files
data/                 — Runtime data (gitignored)
```

## 🔒 Security Notes

- Never commit your `.env` file — it's gitignored
- Rotate your API keys before pushing to a public repository
- The `.wwebjs_auth` folder contains your WhatsApp session — it's gitignored

## 📄 License

ISC
