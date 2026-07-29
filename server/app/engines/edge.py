from __future__ import annotations

import asyncio
import io
import tempfile
from pathlib import Path

from .base import SynthResult, TTSEngine

# Curated Edge neural voices (full list fetched live when online)
EDGE_VOICES = [
    ("en-US-AriaNeural", "Aria (US female)", "en-US"),
    ("en-US-JennyNeural", "Jenny (US female)", "en-US"),
    ("en-US-GuyNeural", "Guy (US male)", "en-US"),
    ("en-US-AndrewNeural", "Andrew (US male)", "en-US"),
    ("en-US-EmmaNeural", "Emma (US female)", "en-US"),
    ("en-US-BrianNeural", "Brian (US male)", "en-US"),
    ("en-US-MichelleNeural", "Michelle (US female)", "en-US"),
    ("en-US-ChristopherNeural", "Christopher (US male)", "en-US"),
    ("en-GB-SoniaNeural", "Sonia (UK female)", "en-GB"),
    ("en-GB-RyanNeural", "Ryan (UK male)", "en-GB"),
    ("en-AU-NatashaNeural", "Natasha (AU female)", "en-AU"),
    ("en-AU-WilliamNeural", "William (AU male)", "en-AU"),
]


def speed_to_edge_rate(speed: float | None) -> str:
    """Map playback multiplier → edge-tts --rate (e.g. 1.25 → +25%)."""
    if speed is None or abs(speed - 1.0) < 0.01:
        return "+0%"
    pct = int(round((speed - 1.0) * 100))
    return f"{pct:+d}%"


class EdgeEngine(TTSEngine):
    """Microsoft Edge online neural TTS (free). Requires network."""

    name = "edge"

    def __init__(self) -> None:
        self._voices_cache: list[dict] | None = None
        self._online: bool | None = None

    def available(self) -> bool:
        try:
            import edge_tts  # noqa: F401

            return True
        except Exception:
            return False

    def probe_online(self, timeout: float = 2.5) -> bool:
        if self._online is True:
            return True
        try:
            import urllib.request

            req = urllib.request.Request(
                "https://www.bing.com",
                method="HEAD",
                headers={"User-Agent": "ListenTTS/0.1"},
            )
            with urllib.request.urlopen(req, timeout=timeout):
                self._online = True
                return True
        except Exception:
            self._online = False
            return False

    def list_voices(self) -> list[dict]:
        voices = [
            {
                "id": f"edge:{vid}",
                "name": f"{label} · Edge",
                "language": lang,
                "engine": "edge",
                "has_prompt": True,
                "style_hint": "neural-online",
            }
            for vid, label, lang in EDGE_VOICES
        ]
        # Merge live catalog when possible (en-* first)
        try:
            if self.probe_online():
                if self._voices_cache is None:
                    self._voices_cache = asyncio.run(self._fetch_voices())
                known = {v["id"] for v in voices}
                for v in self._voices_cache:
                    if v["id"] not in known:
                        voices.append(v)
        except Exception:
            pass
        return voices

    async def _fetch_voices(self) -> list[dict]:
        import edge_tts

        raw = await edge_tts.list_voices()
        out: list[dict] = []
        for v in raw:
            short = v.get("ShortName") or v.get("Name") or ""
            if not short:
                continue
            locale = v.get("Locale") or short.split("-")[0]
            gender = v.get("Gender") or ""
            out.append(
                {
                    "id": f"edge:{short}",
                    "name": f"{short} ({gender}) · Edge",
                    "language": locale,
                    "engine": "edge",
                    "has_prompt": True,
                    "style_hint": "neural-online",
                }
            )
        # Prefer en-US / en-GB near top of extras
        out.sort(key=lambda x: (0 if str(x["language"]).startswith("en") else 1, x["name"]))
        return out

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
        _ = (emotion, style, editx_speed, language_tag)
        if not self.probe_online():
            raise RuntimeError("Edge TTS requires internet — offline")

        voice = (voice_id or "en-US-AriaNeural").removeprefix("edge:")
        rate = speed_to_edge_rate(speed)

        async def _run() -> bytes:
            import edge_tts

            communicate = edge_tts.Communicate(text, voice, rate=rate)
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                path = Path(tmp.name)
            try:
                await communicate.save(str(path))
                return path.read_bytes()
            finally:
                path.unlink(missing_ok=True)

        mp3 = asyncio.run(_run())
        # Prefer wav for consistent decoding; fall back to mp3 (browser can play it)
        try:
            import soundfile as sf
            import numpy as np
            import subprocess
            import shutil

            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as src:
                src.write(mp3)
                src_path = Path(src.name)
            wav_path = src_path.with_suffix(".wav")
            try:
                if shutil.which("ffmpeg"):
                    subprocess.run(
                        ["ffmpeg", "-y", "-i", str(src_path), "-ac", "1", str(wav_path)],
                        check=True,
                        capture_output=True,
                    )
                elif shutil.which("afconvert"):
                    # afconvert may not read mp3 on all macOS versions — try anyway
                    subprocess.run(
                        ["afconvert", "-f", "WAVE", "-d", "LEI16", str(src_path), str(wav_path)],
                        check=True,
                        capture_output=True,
                    )
                else:
                    raise RuntimeError("no converter")
                audio_bytes = wav_path.read_bytes()
                info = sf.info(io.BytesIO(audio_bytes))
                return SynthResult(audio_bytes, int(info.samplerate), "wav", "edge")
            finally:
                src_path.unlink(missing_ok=True)
                wav_path.unlink(missing_ok=True)
        except Exception:
            return SynthResult(mp3, 24000, "mp3", "edge")
