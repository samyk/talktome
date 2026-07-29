from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import settings
from .base import SynthResult, TTSEngine
from .openai_compat import OpenAICompatTTS

QWEN_VOICES = [
    ("Vivian", "Vivian"),
    ("Serena", "Serena"),
    ("Uncle_Fu", "Uncle Fu"),
    ("Dylan", "Dylan"),
    ("Eric", "Eric"),
    ("Ryan", "Ryan"),
    ("Aiden", "Aiden"),
    ("Ono_Anna", "Ono Anna"),
    ("Sohee", "Sohee"),
]


class Qwen3Engine(TTSEngine):
    """
    Qwen3-TTS (Alibaba).

    Prefer OpenAI-compatible / vLLM-Omni endpoint via LISTEN_QWEN3_URL,
    or local `qwen_tts.Qwen3TTSModel` when installed.
    """

    name = "qwen3"

    def __init__(self) -> None:
        self._model = None
        self._compat = OpenAICompatTTS(
            base_url=settings.qwen3_url,
            api_key=settings.qwen3_api_key,
            model=settings.qwen3_model,
            voice=settings.qwen3_voice,
        )

    def available(self) -> bool:
        if settings.qwen3_url:
            return True
        try:
            import qwen_tts  # noqa: F401

            return True
        except Exception:
            try:
                from qwen_tts import Qwen3TTSModel  # noqa: F401

                return True
            except Exception:
                return bool(settings.qwen3_model_path)

    def list_voices(self) -> list[dict]:
        voices = []
        for vid, label in QWEN_VOICES:
            voices.append(
                {
                    "id": f"qwen3:{vid.strip()}",
                    "name": f"{label} · Qwen3-TTS",
                    "language": "en",
                    "engine": "qwen3",
                    "has_prompt": False,
                    "style_hint": "custom-voice",
                }
            )
        voices.insert(
            0,
            {
                "id": "qwen3:default",
                "name": "Qwen3-TTS (default / CustomVoice)",
                "language": "en",
                "engine": "qwen3",
                "has_prompt": False,
            },
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
        if settings.qwen3_url:
            voice = (voice_id or "").removeprefix("qwen3:")
            return self._compat.synthesize(text, voice=voice if voice and voice != "default" else None)

        return self._synthesize_local(text, voice_id)

    def _synthesize_local(self, text: str, voice_id: str | None) -> SynthResult:
        voice = (voice_id or settings.qwen3_voice or "Vivian").removeprefix("qwen3:")
        if voice == "default":
            voice = "Vivian"

        model_id = settings.qwen3_model_path or settings.qwen3_model or "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"

        if self._model is None:
            try:
                from qwen_tts import Qwen3TTSModel
            except Exception as exc:
                raise RuntimeError(
                    "qwen-tts not installed. pip install qwen-tts  OR set LISTEN_QWEN3_URL"
                ) from exc
            self._model = Qwen3TTSModel.from_pretrained(model_id)

        # API surface has evolved — try common methods
        wav = None
        sr = 24000
        m = self._model
        if hasattr(m, "generate_custom_voice"):
            out = m.generate_custom_voice(text=text, speaker=voice, language="English")
            wav, sr = self._unpack(out)
        elif hasattr(m, "generate"):
            out = m.generate(text=text, voice=voice)
            wav, sr = self._unpack(out)
        else:
            raise RuntimeError("Unsupported qwen-tts API — set LISTEN_QWEN3_URL to an OpenAI-compatible server")

        buf = io.BytesIO()
        sf.write(buf, np.asarray(wav, dtype=np.float32).reshape(-1), int(sr), format="WAV", subtype="PCM_16")
        return SynthResult(buf.getvalue(), int(sr), "wav", "qwen3")

    def _unpack(self, out) -> tuple[np.ndarray, int]:
        if isinstance(out, tuple) and len(out) >= 2:
            return np.asarray(out[0], dtype=np.float32), int(out[1])
        if isinstance(out, dict):
            audio = out.get("audio") or out.get("wav")
            sr = int(out.get("sample_rate") or out.get("sr") or 24000)
            return np.asarray(audio, dtype=np.float32), sr
        return np.asarray(out, dtype=np.float32), 24000
