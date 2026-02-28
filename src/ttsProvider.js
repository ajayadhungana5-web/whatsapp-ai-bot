const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');

console.log(`[TTSProvider] Setting FFmpeg Path: ${ffmpegPath}`);

class TTSProvider {
    constructor() {
        // PRIMARY Voice (English)
        this.voiceEnglish = 'en-IN-PrabhatNeural';
        // SECONDARY Voice (Nepali - Female, user-preferred)
        this.voiceNepali = 'ne-NP-HemkalaNeural';

        // Prosody (natural - let the voice model handle tone)
        this.rateGlobal = '+0%';
        this.pitchGlobal = '+0Hz';

        this.scriptPath = path.join(__dirname, 'python/tts.py');
    }

    /**
     * Generates MP3 audio from text using edge-tts (Python).
     * Uses natural punctuation for pacing (NO inline SSML tags).
     * @param {string} text 
     * @returns {Promise<string>} Base64 encoded MP3
     */
    async generateAudio(text) {
        return new Promise((resolve) => {
            console.log(`[TTSProvider] Generating audio (Humanized)...`);

            // 1. Pick voice based on script
            const isNepali = /[\u0900-\u097F]/.test(text);
            const voice = isNepali ? this.voiceNepali : this.voiceEnglish;

            // 2. Clean text (remove markdown, keep natural punctuation)
            const cleanText = this._cleanText(text);

            // 3. Write to temp file (avoids CLI quoting issues on Windows)
            const tempFile = path.join(__dirname, `../temp_${Date.now()}.txt`);
            fs.writeFileSync(tempFile, cleanText, 'utf8');

            // 4. Call Python edge-tts
            const cmd = `python "${this.scriptPath}" "${tempFile}" "${voice}" "${this.rateGlobal}" "${this.pitchGlobal}"`;

            exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                // Cleanup temp file
                try { fs.unlinkSync(tempFile); } catch (e) { }

                if (error) {
                    console.error(`[TTSProvider] Error:`, error.message);
                    resolve(null);
                    return;
                }

                const base64Audio = stdout.trim();
                if (!base64Audio) {
                    console.error(`[TTSProvider] No audio output`);
                    resolve(null);
                    return;
                }

                console.log(`[TTSProvider] ✅ Audio generated`);
                resolve(base64Audio);
            });
        });
    }

    /**
     * Cleans AI response text for natural TTS.
     * Removes markdown but preserves natural punctuation for pacing.
     * The TTS engine naturally pauses on commas, periods, and ellipsis.
     * @param {string} text 
     * @returns {string}
     */
    _cleanText(text) {
        let clean = text;

        // Remove markdown bold/italic markers
        clean = clean.replace(/\*\*(.*?)\*\*/g, '$1');  // **bold** → bold
        clean = clean.replace(/\*(.*?)\*/g, '$1');       // *italic* → italic
        clean = clean.replace(/_(.*?)_/g, '$1');         // _underline_ → underline

        // Remove markdown headers
        clean = clean.replace(/^#{1,6}\s+/gm, '');

        // Remove markdown links [text](url) → text
        clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

        // Remove code blocks
        clean = clean.replace(/```[\s\S]*?```/g, '');
        clean = clean.replace(/`([^`]+)`/g, '$1');

        // Remove bullet points
        clean = clean.replace(/^[\-\*]\s+/gm, '');

        // 1. Convert structural formatting to pauses
        clean = clean.replace(/—/g, ', '); // Em-dash -> Comma (Pause)
        clean = clean.replace(/\.\.\./g, '... '); // Ellipsis -> Ellipsis + Space
        clean = clean.replace(/\n+/g, '. '); // Newlines -> Full stop

        // 2. Remove purely unsupported characters (Keep Devanagari + ASCII + Basic Punctuation)
        // Note: edge-tts handles standard punctuation fine for pacing.
        clean = clean.replace(/[^\u0900-\u097F\u0020-\u007E]/g, '');

        // Remove emoji (they cause TTS to say "emoji face" etc.)
        clean = clean.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '');

        // Trim whitespace
        clean = clean.replace(/\s+/g, ' ').trim();

        return clean;
    }

    /**
     * Converts MP3 Base64 to OGG (Opus) Base64 for WhatsApp PTT
     * @param {string} mp3Base64 
     * @returns {Promise<string>} OGG Base64
     */
    async convertToOgg(mp3Base64) {
        return new Promise((resolve) => {
            const tempId = Date.now();
            const tempMp3 = path.join(__dirname, `../temp_${tempId}.mp3`);
            const tempOgg = path.join(__dirname, `../temp_${tempId}.ogg`);

            try {
                fs.writeFileSync(tempMp3, Buffer.from(mp3Base64, 'base64'));

                const cmd = `"${ffmpegPath}" -i "${tempMp3}" -c:a libopus "${tempOgg}" -y`;

                exec(cmd, (error) => {
                    if (error) {
                        console.error('[TTSProvider] FFmpeg Error:', error.message);
                        try { fs.unlinkSync(tempMp3); if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg); } catch (e) { }
                        resolve(null);
                        return;
                    }

                    if (fs.existsSync(tempOgg)) {
                        const oggBuffer = fs.readFileSync(tempOgg);
                        try { fs.unlinkSync(tempMp3); fs.unlinkSync(tempOgg); } catch (e) { }
                        resolve(oggBuffer.toString('base64'));
                    } else {
                        console.error('[TTSProvider] OGG not created');
                        resolve(null);
                    }
                });
            } catch (e) {
                console.error('[TTSProvider] File Error:', e.message);
                resolve(null);
            }
        });
    }
}

module.exports = TTSProvider;
