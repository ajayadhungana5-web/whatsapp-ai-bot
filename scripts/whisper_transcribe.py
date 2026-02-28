"""
Local Whisper transcription script for WhatsApp AI Bot.
Uses OpenAI's whisper-large-v3 model for best Nepali transcription accuracy.

Usage: python whisper_transcribe.py <audio_file_path> [language]
Output: Prints transcribed text to stdout (JSON format)
"""
import sys
import json
import os
import warnings
import subprocess

# Suppress FP16 warnings on CPU
warnings.filterwarnings("ignore", message="FP16 is not supported on CPU")

# --- FFmpeg Path Setup ---
# Whisper requires ffmpeg in PATH. Helper to find node_modules/ffmpeg-static
def setup_ffmpeg_path():
    # Check if ffmpeg is already in PATH
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return # Already in PATH
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass

    # Look for ffmpeg-static in node_modules
    # Script is in ./scripts/, so node_modules is likely in ../node_modules/
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    ffmpeg_static_path = os.path.join(project_root, "node_modules", "ffmpeg-static", "ffmpeg.exe")
    
    if os.path.exists(ffmpeg_static_path):
        ffmpeg_dir = os.path.dirname(ffmpeg_static_path)
        os.environ["PATH"] += os.pathsep + ffmpeg_dir
        # print(json.dumps({"info": f"Added ffmpeg to PATH from {ffmpeg_dir}"}), file=sys.stderr)

setup_ffmpeg_path()
# -------------------------

def transcribe(audio_path, language="ne"):
    """Transcribe audio file using Whisper large-v3 via HuggingFace Transformers."""
    try:
        from transformers import pipeline
        import torch
        
        # Use large-v3 for best accuracy
        # Transformers pipeline handles model downloading automatically
        model_id = "openai/whisper-large-v3"
        
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32

        # Check available memory (rough heuristic for CPU)
        if device == "cpu":
            try:
                import psutil
                available_gb = psutil.virtual_memory().available / (1024**3)
                if available_gb < 4:
                    model_id = "openai/whisper-small" # Fallback for very low RAM
                    print(json.dumps({"warning": f"Low RAM ({available_gb:.1f}GB), using {model_id}"}), file=sys.stderr)
            except ImportError:
                pass

        # Initialize pipeline
        # chunk_length_s=30 is crucial for long audio
        pipe = pipeline(
            "automatic-speech-recognition",
            model=model_id,
            torch_dtype=torch_dtype,
            device=device,
        )

        # Transcribe
        # generate_kwargs={"language": language} forces the language
        result = pipe(
            audio_path,
            chunk_length_s=30,
            batch_size=8,
            return_timestamps=True,
            generate_kwargs={"language": language}
        )
        
        text = result.get("text", "").strip()
        
        output = {
            "success": True,
            "text": text,
            "model": model_id,
            "device": device
        }
        print(json.dumps(output, ensure_ascii=False))
        
    except Exception as e:
        error_output = {
            "success": False,
            "error": str(e),
            "text": "",
        }
        print(json.dumps(error_output, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: python whisper_transcribe.py <audio_file> [language]"}))
        sys.exit(1)
    
    audio_file = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else "ne"
    
    if not os.path.exists(audio_file):
        print(json.dumps({"success": False, "error": f"File not found: {audio_file}"}))
        sys.exit(1)
    
    transcribe(audio_file, lang)
