from __future__ import annotations

import io
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import settings
from .base import SynthResult, TTSEngine

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

# Curated, natural-sounding defaults first
PREFERRED_VOICES = [
    ("af_heart", "Heart (US female)", "en-US"),
    ("af_bella", "Bella (US female)", "en-US"),
    ("af_sarah", "Sarah (US female)", "en-US"),
    ("af_nicole", "Nicole (US female)", "en-US"),
    ("af_aoede", "Aoede (US female)", "en-US"),
    ("af_kore", "Kore (US female)", "en-US"),
    ("af_jessica", "Jessica (US female)", "en-US"),
    ("am_michael", "Michael (US male)", "en-US"),
    ("am_fenrir", "Fenrir (US male)", "en-US"),
    ("am_puck", "Puck (US male)", "en-US"),
    ("am_adam", "Adam (US male)", "en-US"),
    ("bf_emma", "Emma (UK female)", "en-GB"),
    ("bf_isabella", "Isabella (UK female)", "en-GB"),
    ("bm_george", "George (UK male)", "en-GB"),
    ("bm_lewis", "Lewis (UK male)", "en-GB"),
]


class KokoroEngine(TTSEngine):
    """Neural TTS that actually sounds good on Mac/Windows CPU — no CUDA needed."""

    name = "kokoro"

    def __init__(self) -> None:
        self._kokoro = None
        self._load_error: str | None = None
        self._model_dir = settings.cache_dir / "kokoro"

    def available(self) -> bool:
        try:
            import kokoro_onnx  # noqa: F401

            return True
        except Exception:
            return False

    def _ensure_files(self) -> tuple[Path, Path]:
        self._model_dir.mkdir(parents=True, exist_ok=True)
        model = self._model_dir / "kokoro-v1.0.onnx"
        voices = self._model_dir / "voices-v1.0.bin"
        if not model.exists():
            print(f"[kokoro] downloading model → {model}")
            urllib.request.urlretrieve(MODEL_URL, model)
        if not voices.exists():
            print(f"[kokoro] downloading voices → {voices}")
            urllib.request.urlretrieve(VOICES_URL, voices)
        return model, voices

    def ensure_loaded(self) -> None:
        if self._kokoro is not None:
            return
        if self._load_error:
            raise RuntimeError(self._load_error)
        try:
            from kokoro_onnx import Kokoro

            model, voices = self._ensure_files()
            self._kokoro = Kokoro(str(model), str(voices))
        except Exception as exc:
            self._load_error = f"Failed to load Kokoro: {exc}"
            raise RuntimeError(self._load_error) from exc

    def list_voices(self) -> list[dict]:
        voices = []
        for vid, name, lang in PREFERRED_VOICES:
            voices.append(
                {
                    "id": f"kokoro:{vid}",
                    "name": f"{name} · Kokoro",
                    "language": lang,
                    "engine": "kokoro",
                    "has_prompt": True,
                    "style_hint": "neural",
                }
            )
        # Also expose any extra voices the model knows about
        try:
            self.ensure_loaded()
            assert self._kokoro is not None
            known = set(self._kokoro.get_voices())
            listed = {v for v, _, _ in PREFERRED_VOICES}
            for vid in sorted(known - listed):
                voices.append(
                    {
                        "id": f"kokoro:{vid}",
                        "name": f"{vid} · Kokoro",
                        "language": "en",
                        "engine": "kokoro",
                        "has_prompt": True,
                    }
                )
        except Exception:
            pass
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
        _ = (emotion, style, editx_speed, language_tag)
        self.ensure_loaded()
        assert self._kokoro is not None

        voice = (voice_id or "af_heart").removeprefix("kokoro:")
        if voice in ("default", "system:default", "edge:en-US-AriaNeural", ""):
            voice = "af_heart"

        # lang hint from voice prefix
        lang = "en-us"
        if voice.startswith("bf_") or voice.startswith("bm_"):
            lang = "en-gb"
        elif voice.startswith("ef_") or voice.startswith("em_"):
            lang = "en-us"

        # Prefer client playbackRate for scrubbing; still honor speed if provided
        kspeed = float(speed) if speed else 1.0
        samples, sample_rate = self._kokoro.create(text, voice=voice, speed=kspeed, lang=lang)
        audio = np.asarray(samples, dtype=np.float32)
        buf = io.BytesIO()
        sf.write(buf, audio, int(sample_rate), format="WAV", subtype="PCM_16")
        return SynthResult(
            audio=buf.getvalue(),
            sample_rate=int(sample_rate),
            format="wav",
            engine="kokoro",
        )
