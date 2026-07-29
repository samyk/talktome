from __future__ import annotations

import io
import json
import urllib.error
import urllib.request

from .base import SynthResult


class OpenAICompatTTS:
    """POST {base}/audio/speech — OpenAI-compatible TTS used by SGLang-Omni / vLLM-Omni."""

    def __init__(
        self,
        *,
        base_url: str | None,
        api_key: str | None = None,
        model: str | None = None,
        voice: str | None = None,
    ) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key or "sk-local"
        self.model = model or "tts-1"
        self.voice = voice or "alloy"

    def synthesize(self, text: str, voice: str | None = None) -> SynthResult:
        if not self.base_url:
            raise RuntimeError("No OpenAI-compatible TTS URL configured")

        url = f"{self.base_url}/audio/speech"
        payload = {
            "model": self.model,
            "input": text,
            "voice": voice or self.voice,
            "response_format": "wav",
        }
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                audio = resp.read()
                ctype = resp.headers.get("Content-Type", "audio/wav")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"TTS HTTP {exc.code}: {detail}") from exc

        fmt = "mp3" if "mpeg" in ctype or "mp3" in ctype else "wav"
        # Best-effort sample rate; wav header may differ
        sr = 24000
        if fmt == "wav" and len(audio) > 44:
            try:
                import soundfile as sf

                info = sf.info(io.BytesIO(audio))
                sr = int(info.samplerate)
            except Exception:
                pass
        return SynthResult(audio, sr, fmt, "openai-compat")
