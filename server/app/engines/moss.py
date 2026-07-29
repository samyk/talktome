from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import settings
from .base import SynthResult, TTSEngine
from .openai_compat import OpenAICompatTTS


class MossEngine(TTSEngine):
    """
    MOSS-TTS (OpenMOSS).

    Prefer OpenAI-compatible endpoint (SGLang-Omni / vLLM-Omni):
      LISTEN_MOSS_URL=http://127.0.0.1:8000/v1
    Or local transformers install of MOSS-TTS.
    """

    name = "moss"

    def __init__(self) -> None:
        self._model = None
        self._processor = None
        self._compat = OpenAICompatTTS(
            base_url=settings.moss_url,
            api_key=settings.moss_api_key,
            model=settings.moss_model,
            voice=settings.moss_voice,
        )

    def available(self) -> bool:
        if settings.moss_url:
            return True
        try:
            from transformers import AutoModel, AutoProcessor  # noqa: F401

            return bool(settings.moss_model_path)
        except Exception:
            return False

    def list_voices(self) -> list[dict]:
        return [
            {
                "id": "moss:default",
                "name": "MOSS-TTS Local (default)",
                "language": "en",
                "engine": "moss",
                "has_prompt": bool(settings.moss_ref_audio),
                "style_hint": "high-fidelity local / remote",
            }
        ]

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
        _ = (voice_id, emotion, style, editx_speed, language_tag, speed)
        if settings.moss_url:
            return self._compat.synthesize(text)

        return self._synthesize_local(text)

    def _synthesize_local(self, text: str) -> SynthResult:
        from transformers import AutoModel, AutoProcessor

        path = str(settings.moss_model_path or "OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5")
        if self._model is None:
            self._processor = AutoProcessor.from_pretrained(path, trust_remote_code=True)
            self._model = AutoModel.from_pretrained(path, trust_remote_code=True)
            try:
                import torch

                device = "cuda" if torch.cuda.is_available() else "cpu"
                self._model = self._model.to(device)
                if hasattr(self._processor, "audio_tokenizer"):
                    self._processor.audio_tokenizer = self._processor.audio_tokenizer.to(device)
            except Exception:
                pass

        assert self._processor is not None and self._model is not None
        msg_kwargs: dict = {"text": text}
        if settings.moss_ref_audio and Path(settings.moss_ref_audio).exists():
            # zero-shot clone when prompt provided — API varies by version
            msg_kwargs["ref_audio"] = str(settings.moss_ref_audio)

        batch = self._processor(
            [[self._processor.build_user_message(**msg_kwargs)]],
            mode="generation",
        )
        outputs = self._model.generate(batch)
        audio = self._extract_audio(outputs)
        sr = 48000
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
        return SynthResult(buf.getvalue(), sr, "wav", "moss")

    def _extract_audio(self, outputs) -> np.ndarray:
        # Best-effort across MOSS output shapes
        if isinstance(outputs, dict):
            for key in ("audio", "audios", "wav", "waveform"):
                if key in outputs:
                    arr = outputs[key]
                    if isinstance(arr, (list, tuple)):
                        arr = arr[0]
                    return np.asarray(arr, dtype=np.float32).reshape(-1)
        if hasattr(outputs, "audios"):
            return np.asarray(outputs.audios[0], dtype=np.float32).reshape(-1)
        if isinstance(outputs, (list, tuple)) and outputs:
            return np.asarray(outputs[0], dtype=np.float32).reshape(-1)
        raise RuntimeError("Unrecognized MOSS-TTS output format")
