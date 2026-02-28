import asyncio
import edge_tts
import sys
import base64
import os

# Usage: python tts.py "Text or FilePath" "Voice" "Rate" "Pitch"
async def main():
    input_arg = sys.argv[1] if len(sys.argv) > 1 else "Hello"
    voice = sys.argv[2] if len(sys.argv) > 2 else "en-IN-PrabhatNeural"
    rate = sys.argv[3] if len(sys.argv) > 3 else "+0%"
    pitch = sys.argv[4] if len(sys.argv) > 4 else "+0Hz"

    # Check if input is a file path
    if os.path.exists(input_arg) and (input_arg.endswith('.txt') or input_arg.endswith('.ssml')):
        try:
            with open(input_arg, 'r', encoding='utf-8') as f:
                text = f.read().strip()
        except:
            text = input_arg
    else:
        text = input_arg

    # Pass plain text to edge-tts with voice, rate, pitch.
    # The library wraps it in SSML internally.
    # No inline SSML tags — they are NOT supported by this API.
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    
    audio_data = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data += chunk["data"]
            
    print(base64.b64encode(audio_data).decode('utf-8'))

if __name__ == "__main__":
    asyncio.run(main())
