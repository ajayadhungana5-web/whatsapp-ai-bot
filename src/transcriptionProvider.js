const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const OpenAI = require('openai');
const config = require('../config/config');
const { exec } = require('child_process');

// API Keys - Strict check for real keys
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || config.ai.openai?.apiKey || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

// Helper: Check if an API key looks real (not a placeholder)
function isRealKey(key) {
    if (!key || key.length < 10) return false;
    // Reject common placeholder patterns
    const placeholders = ['your-api', 'sk-xxx', 'your_api', 'api-key-here', 'CHANGE_ME', 'undefined', 'placeholder'];
    return !placeholders.some(p => key.toLowerCase().includes(p.toLowerCase()));
}

class TranscriptionProvider {
    constructor() {
        // Priority: OpenAI Whisper > Groq Whisper > Local Python Whisper (Large-v3) > Local Xenova (Small)
        this.openaiClient = null;
        this.useOpenAI = false;
        this.useGroq = false;

        // 1. Try OpenAI direct (High Accuracy, Paid)
        if (isRealKey(OPENAI_API_KEY)) {
            this.openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
            this.useOpenAI = true;
            console.log(`[TranscriptionProvider] ✅ OpenAI Whisper API Enabled (Priority 1)`);
        } else {
            console.log(`[TranscriptionProvider] ⚠️ OpenAI API Key missing/invalid. Skipping Priority 1.`);
        }

        // 2. Groq Whisper fallback (Fast, Free)
        if (isRealKey(GROQ_API_KEY)) {
            this.groqClient = new OpenAI({
                apiKey: GROQ_API_KEY,
                baseURL: 'https://api.groq.com/openai/v1',
            });
            this.useGroq = true;
            console.log(`[TranscriptionProvider] ✅ Groq Whisper API Enabled (Priority 2)`);
        }

        // 3. Local Python Whisper (High Accuracy, Slow, Offline)
        // Check if python script exists
        this.pythonScriptPath = path.join(__dirname, '../scripts/whisper_transcribe.py');
        if (fs.existsSync(this.pythonScriptPath)) {
            console.log(`[TranscriptionProvider] ✅ Local Python Whisper Script Found (Priority 3)`);
        } else {
            console.warn(`[TranscriptionProvider] ⚠️ Local Python Script missing at ${this.pythonScriptPath}`);
        }

        // 4. Local Xenova (Fast, Offline, Lower Accuracy) backup
        this._initPromise = this._initLocalXenova();
    }

    async _initLocalXenova() {
        try {
            const { pipeline } = require('@xenova/transformers');
            this.modelName = 'Xenova/whisper-small'; // Small model for acceptable speed on CPU
            // console.log(`[TranscriptionProvider] Loading local Xenova model backup...`);
            this.xenovaTranscriber = await pipeline('automatic-speech-recognition', this.modelName);
            console.log(`[TranscriptionProvider] ✅ Local Xenova backup loaded (Priority 4).`);
        } catch (e) {
            console.error(`[TranscriptionProvider] Failed to load local Xenova model:`, e.message);
        }
    }

    /**
     * Fix common phonetic errors in transcription (e.g. Cortha -> Karta)
     */
    _postProcess(text) {
        if (!text) return text;

        let processed = text;

        // Brand Name Fixes: "Cortha", "Kortha", "Kurta" -> "Karta"
        // Use word boundaries to avoid replacing parts of other words
        // Case-insensitive replacement
        const brandMisspellings = [
            'Cortha', 'Kortha', 'Corta', 'Kurta', 'Carta', 'Courta', 'Cart A', 'Karth a', 'Kor tha'
        ];

        // Create a regex that matches any of these variations
        const brandRegex = new RegExp(`\\b(${brandMisspellings.join('|')})\\b`, 'gi');

        if (brandRegex.test(processed)) {
            console.log(`[TranscriptionProvider] 🔧 Fixing Brand Name: "${processed}"`);
            processed = processed.replace(brandRegex, 'Karta');
        }

        // Common Nepali Phonetic Fixes (Crucial to prevent context hallucination)
        // "Mahile" (Woman-sounding) -> "Maile" (I)
        processed = processed.replace(/\b(Mahile|Mahila|Mहिले)\b/gi, 'Maile');

        // "Ramla" -> "Ramro lagyo" (Liked it)
        processed = processed.replace(/\b(Ramla|Ramlo)\b/gi, 'Ramro lagyo');

        // "Che" -> "Chai" (Emphasis particle)
        processed = processed.replace(/\b(Che|Chhe)\b/gi, 'Chai');

        // --- Devanagari Phonetic Fixes (Speech to Text Repair) ---
        // "Mohile" (Wrong) -> "Maile" (Correct: I)
        processed = processed.replace(/\b(मोहिले|महिले)\b/g, 'मैले');

        // "Bhaneku" (Wrong) -> "Bhaneko" (Correct: Said)
        processed = processed.replace(/\b(बहनेकु|बनेको|भानेको)\b/g, 'भनेको');

        // "Par chak" (Wrong Spacing) -> "Parcha" (Correct: Costs/Happens)
        processed = processed.replace(/\b(पर चक|पर छक|पर्छक)\b/g, 'पर्छ');

        // "Bana" (Make) -> "Bhana" (Tell - context specific)
        // Only if followed by "kati" (how much) -> "Bhana kati" (Tell me how much)
        processed = processed.replace(/\b(बना)(\s+कति)\b/g, 'भन$2');

        if (text !== processed) {
            console.log(`[TranscriptionProvider] ✅ Creating corrected text: "${processed}"`);
        }

        return processed;
    }

    /**
     * Convert audio buffer to WAV (16kHz Mono) for Whisper
     * Returns the temp WAV file path. Caller must delete it.
     */
    async _convertToWav(audioBuffer) {
        const tempId = Date.now() + Math.floor(Math.random() * 1000);
        const tempOgg = path.join(__dirname, `../temp_raw_${tempId}.ogg`);
        const tempWav = path.join(__dirname, `../temp_clean_${tempId}.wav`);

        try {
            fs.writeFileSync(tempOgg, audioBuffer);

            // Validate file size
            const stats = fs.statSync(tempOgg);
            if (stats.size < 100) {
                console.warn(`[TranscriptionProvider] Audio too small (${stats.size} bytes), might be silence.`);
            }

            await new Promise((resolve, reject) => {
                // -y: overwrite
                // -vn: disable video
                // -acodec pcm_s16le: 16-bit PCM WAV (standard for Whisper)
                // -ar 16000: 16kHz sample rate (standard for Whisper)
                // -ac 1: Mono channel
                exec(`"${ffmpegPath}" -i "${tempOgg}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempWav}" -y`, (err) => {
                    if (err) reject(err); else resolve();
                });
            });

            return tempWav;
        } finally {
            // Always cleanup OGG source
            if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);
        }
    }

    /**
     * Transcribe using OpenAI Whisper API — Best Accuracy
     */
    async _transcribeOpenAI(tempWav) {
        try {
            console.log(`[TranscriptionProvider] 🚀 Calling OpenAI Whisper API...`);
            const startTime = Date.now();

            const transcription = await this.openaiClient.audio.transcriptions.create({
                file: fs.createReadStream(tempWav),
                model: 'whisper-1',
                language: 'ne', // Explicit Nepali hint
                response_format: 'json',
                prompt: 'Nepali conversation. Uses both Devanagari and Roman scripts.', // Context hint
            });

            const elapsed = Date.now() - startTime;
            const text = transcription.text?.trim();
            if (text) {
                console.log(`[TranscriptionProvider] ✅ OpenAI Whisper (${elapsed}ms): "${text}"`);
                return this._postProcess(text);
            }
        } catch (error) {
            console.error('[TranscriptionProvider] OpenAI Whisper error:', error.message);
        }
        return null;
    }

    /**
     * Transcribe using Groq Whisper API — Fast & Free
     * Using `whisper-large-v3` for better multilingual support
     */
    async _transcribeGroq(tempWav) {
        try {
            console.log(`[TranscriptionProvider] 🚀 Calling Groq Whisper API (large-v3)...`);
            const startTime = Date.now();

            const transcription = await this.groqClient.audio.transcriptions.create({
                file: fs.createReadStream(tempWav),
                model: 'whisper-large-v3', // Changed from turbo to full model for accuracy
                language: 'ne',
                response_format: 'json',
                // prompt: '', // Removed prompt to avoid conflict with language param on Groq
            });

            const elapsed = Date.now() - startTime;
            const text = transcription.text?.trim();

            if (text) {
                // Hallucination Check: Common Whisper hallucinations on silence/noise
                const hallucinations = [
                    "Sunset Soul", "Subtitle by", "Amara.org", "Thank you", "Bye",
                    "Copyright", "©", "MBC", "S u b t i t l e", "Kids of Huber"
                ];

                // If it's very short English text but we expect Nepali, it's likely garbage
                const isSuspicious = hallucinations.some(h => text.includes(h)) ||
                    (text.length < 15 && /^[A-Za-z\s.,!?]+$/.test(text)); // Short pure English

                if (isSuspicious) {
                    console.warn(`[TranscriptionProvider] ⚠️ Groq potential hallucination detected: "${text}". Falling back to Local.`);
                    return null; // Force fallback to next provider (Local Python)
                }

                console.log(`[TranscriptionProvider] ✅ Groq Whisper (${elapsed}ms): "${text}"`);
                return this._postProcess(text);
            }
        } catch (error) {
            console.error('[TranscriptionProvider] Groq Whisper error:', error.message);
        }
        return null;
    }

    /**
     * Transcribe using Local Python Script (Whisper Large-v3)
     */
    async _transcribeLocalPython(tempWav) {
        if (!fs.existsSync(this.pythonScriptPath)) return null;

        try {
            console.log(`[TranscriptionProvider] 🐍 Running Local Whisper (Python)...`);
            const startTime = Date.now();

            // Execute python script
            const result = await new Promise((resolve, reject) => {
                exec(`python "${this.pythonScriptPath}" "${tempWav}" ne`, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                    if (error) {
                        // Don't reject, just resolve null so we fallback
                        console.warn("[TranscriptionProvider] Python script error:", stderr);
                        resolve(null);
                        return;
                    }
                    try {
                        const output = JSON.parse(stdout);
                        if (output.success && output.text) {
                            resolve(output.text);
                        } else {
                            console.warn("[TranscriptionProvider] Python script failed:", output.error);
                            resolve(null);
                        }
                    } catch (e) {
                        console.warn("[TranscriptionProvider] Python JSON parse error:", e.message, stdout);
                        resolve(null);
                    }
                });
            });

            if (result) {
                const elapsed = Date.now() - startTime;
                console.log(`[TranscriptionProvider] ✅ Local Whisper (${elapsed}ms): "${result}"`);
                return this._postProcess(result);
            }
        } catch (error) {
            console.error('[TranscriptionProvider] Local Python execution error:', error.message);
        }
        return null;
    }

    /**
     * Local Xenova fallback (Javascript-only)
     */
    async _transcribeLocalXenova(audioBuffer) {
        // Wait for model if still loading
        if (this._initPromise) await this._initPromise;
        if (!this.xenovaTranscriber) return null;

        try {
            // Need a separate WAV conversion for Xenova that returns raw data, 
            // but we can reuse the buffer logic if we refactor. 
            // For now, let's keep it simple and re-process buffer -> wavefile.

            // Generate ONE temp wav for Xenova
            const tempWav = await this._convertToWav(audioBuffer);
            const wavBuffer = fs.readFileSync(tempWav);
            fs.unlinkSync(tempWav); // Xenova reads buffer, file not needed anymore

            const wavefile = require('wavefile');
            const wav = new wavefile.WaveFile(wavBuffer);
            wav.toBitDepth('32f');
            let audioData = wav.getSamples();
            if (Array.isArray(audioData)) audioData = audioData[0];

            console.log(`[TranscriptionProvider] 🤖 Transcribing with Local Xenova (Backup)...`);
            const output = await this.xenovaTranscriber(audioData, {
                task: 'transcribe',
                language: 'nepali',
                chunk_length_s: 30,
            });

            const text = output.text || output[0]?.text || '';
            const cleaned = text.trim();
            console.log(`[TranscriptionProvider] ✅ Xenova Whisper: "${cleaned}"`);
            return this._postProcess(cleaned);

        } catch (error) {
            console.error('[TranscriptionProvider] Local Xenova error:', error.message);
            return null;
        }
    }

    /**
     * Main transcription orchestration
     */
    async transcribe(audioBuffer) {
        let tempWav = null;
        try {
            // Convert once for API/Python consumption
            tempWav = await this._convertToWav(audioBuffer);

            // 1. Try OpenAI Whisper (Best Accuracy)
            if (this.useOpenAI) {
                const result = await this._transcribeOpenAI(tempWav);
                if (result) return result;
                console.log('[TranscriptionProvider] OpenAI failed, trying Priority 2...');
            }

            // 2. Try Groq Whisper (Fast, Free, Good Accuracy)
            if (this.useGroq) {
                const result = await this._transcribeGroq(tempWav);
                if (result) return result;
                console.log('[TranscriptionProvider] Groq failed, trying Priority 3...');
            }

            // 3. Try Local Python Whisper (Best Offline Accuracy)
            // This is heavy, so it's 3rd priority
            const pythonResult = await this._transcribeLocalPython(tempWav);
            if (pythonResult) return pythonResult;

            console.log('[TranscriptionProvider] Python Whisper failed using Priority 4 (Xenova)...');

        } catch (err) {
            console.error('[TranscriptionProvider] Critical error in pipeline:', err);
        } finally {
            // Cleanup temp file
            if (tempWav && fs.existsSync(tempWav)) {
                try { fs.unlinkSync(tempWav); } catch (e) { }
            }
        }

        // 4. Fallback to Xenova (JS-based, robust but less accurate)
        // Pass original buffer since it handles its own conversion
        return await this._transcribeLocalXenova(audioBuffer);
    }
}

module.exports = TranscriptionProvider;
