from __future__ import annotations

import io
import platform
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import soundfile as sf

from .base import SynthResult, TTSEngine

# Prefer real reading voices; novelty/compact junk last.
PREFERRED_MAC_VOICES = [
    "Samantha",
    "Ava",
    "Zoe",
    "Allison",
    "Susan",
    "Tom",
    "Alex",
    "Daniel",
    "Karen",
    "Moira",
    "Fiona",
    "Veena",
    "Rishi",
    "Tessa",
    "Lee",
    "Kate",
    "Oliver",
    "Serena",
]

NOVELTY = {
    "Albert",
    "Bad",
    "Bahh",
    "Bells",
    "Boing",
    "Bubbles",
    "Cellos",
    "Good",
    "Jester",
    "Organ",
    "Superstar",
    "Trinoids",
    "Whisper",
    "Wobble",
    "Zarvox",
    "Junior",
    "Kathy",
    "Princess",
    "Ralph",
    "Fred",
}


def _parse_say_voices(raw: str) -> list[tuple[str, str]]:
    """Return (voice_name, lang) from `say -v ?` output."""
    voices: list[tuple[str, str]] = []
    for line in raw.splitlines():
        # "Samantha            en_US    # Hello!..."
        # "Eddy (English (US)) en_US    # Hello!..."
        m = re.match(r"^(.+?)\s+([a-z]{2}[_-][A-Z]{2})\s+#", line)
        if not m:
            continue
        name = m.group(1).strip()
        lang = m.group(2).replace("_", "-")
        voices.append((name, lang))
    return voices


def _rank_key(name: str, lang: str) -> tuple:
    base = name.split()[0]
    novelty = 1 if base in NOVELTY or name.startswith(("Eddy", "Flo", "Grandma", "Grandpa", "Rocko", "Sandy", "Shelley")) else 0
    # Prefer en-*
    lang_score = 0 if lang.lower().startswith("en") else 1
    try:
        pref = PREFERRED_MAC_VOICES.index(base)
    except ValueError:
        pref = 100 + (0 if "Premium" in name or "Enhanced" in name else 50)
    # Premium/Enhanced boost
    quality = 0 if ("Premium" in name or "Enhanced" in name) else 1
    return (novelty, quality, lang_score, pref, name.lower())


class SystemTTSEngine(TTSEngine):
    """macOS `say` / Windows SAPI / espeak-ng fallback."""

    name = "system"

    def available(self) -> bool:
        system = platform.system()
        if system == "Darwin":
            return shutil.which("say") is not None
        if system == "Windows":
            return True
        return shutil.which("espeak-ng") is not None or shutil.which("espeak") is not None

    def list_voices(self) -> list[dict]:
        system = platform.system()
        voices: list[dict] = []
        if system == "Darwin":
            try:
                out = subprocess.check_output(["say", "-v", "?"], text=True, stderr=subprocess.DEVNULL)
                parsed = _parse_say_voices(out)
                parsed.sort(key=lambda pair: _rank_key(pair[0], pair[1]))
                for name, lang in parsed:
                    base = name.split()[0]
                    if base in NOVELTY:
                        continue  # hide novelty voices from the picker
                    label = name
                    if "Premium" in name or "Enhanced" in name:
                        label = f"{name} ★"
                    voices.append(
                        {
                            "id": f"system:{name}",
                            "name": f"{label} (system)",
                            "language": lang,
                            "engine": "system",
                            "has_prompt": False,
                        }
                    )
            except Exception:
                voices.append(
                    {
                        "id": "system:Samantha",
                        "name": "Samantha (system)",
                        "language": "en-US",
                        "engine": "system",
                        "has_prompt": False,
                    }
                )
        elif system == "Windows":
            voices.append(
                {
                    "id": "system:default",
                    "name": "Windows SAPI (default)",
                    "language": "en-US",
                    "engine": "system",
                    "has_prompt": False,
                }
            )
        else:
            voices.append(
                {
                    "id": "system:default",
                    "name": "espeak (system)",
                    "language": "en",
                    "engine": "system",
                    "has_prompt": False,
                }
            )
        return voices

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str | None = None,
        emotion: str | None = None,
        style: str | None = None,
        editx_speed: str | None = None,
        language_tag: str | None = None,
        speed: float | None = None,
    ) -> SynthResult:
        _ = (emotion, style, editx_speed, language_tag, speed)
        voice = (voice_id or "system:Samantha").removeprefix("system:")
        if voice in ("default", "Albert", ""):
            voice = "Samantha"
        system = platform.system()

        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / "out.wav"
            aiff_path = Path(tmp) / "out.aiff"

            if system == "Darwin":
                cmd = ["say", "-o", str(aiff_path)]
                if voice and voice != "default":
                    cmd.extend(["-v", voice])
                cmd.append(text)
                subprocess.run(cmd, check=True, capture_output=True)
                if shutil.which("afconvert"):
                    # 48k 16-bit for cleaner playback than default
                    subprocess.run(
                        [
                            "afconvert",
                            "-f",
                            "WAVE",
                            "-d",
                            "LEI16@48000",
                            str(aiff_path),
                            str(out_path),
                        ],
                        check=True,
                        capture_output=True,
                    )
                else:
                    data, sr = sf.read(str(aiff_path))
                    sf.write(str(out_path), data, sr)
            elif system == "Windows":
                ps = f"""
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile('{out_path.as_posix()}')
$synth.Speak(@'
{text.replace("'", "''")}
'@)
$synth.Dispose()
"""
                subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps],
                    check=True,
                    capture_output=True,
                )
            else:
                bin_name = shutil.which("espeak-ng") or shutil.which("espeak")
                if not bin_name:
                    raise RuntimeError("No system TTS backend found (espeak-ng / espeak)")
                subprocess.run(
                    [bin_name, "-w", str(out_path), text],
                    check=True,
                    capture_output=True,
                )

            audio_bytes = out_path.read_bytes()
            info = sf.info(io.BytesIO(audio_bytes))
            return SynthResult(
                audio=audio_bytes,
                sample_rate=int(info.samplerate),
                format="wav",
                engine="system",
            )
