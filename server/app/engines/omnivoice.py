from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import settings
from .base import SynthResult, TTSEngine
from .openai_compat import OpenAICompatTTS


class OmniVoiceEngine(TTSEngine):
    """
    OmniVoice (k2-fsa) — multilingual zero-shot TTS.

    Uses LISTEN_OMNIVOICE_URL OpenAI-compat endpoint, or local `omnivoice` package
    with a reference wav (voices/default/prompt.wav).
    """

    name = "omnivoice"

    def __init__(self) -> None:
        self._model = None
        self._compat = OpenAICompatTTS(
            base_url=settings.omnivoice_url,
            api_key=settings.omnivoice_api_key,
            model=settings.omnivoice_model,
            voice="default",
        )

    def available(self) -> bool:
        if settings.omnivoice_url:
            return True
        try:
            from omnivoice import OmniVoice  # noqa: F401

            return True
        except Exception:
            return False

    def list_voices(self) -> list[dict]:
        voices = [
            {
                "id": "omnivoice:default",
                "name": "OmniVoice (clone from prompt.wav)",
                "language": "multi",
                "engine": "omnivoice",
                "has_prompt": True,
                "style_hint": "zero-shot clone",
            }
        ]
        # Extra named prompts under voices/
        for meta in sorted(settings.voices_dir.glob("*/voice.json")):
            vid = meta.parent.name
            if vid == "default":
                continue
            voices.append(
                {
                    "id": f"omnivoice:{vid}",
                    "name": f"OmniVoice · {vid}",
                    "language": "multi",
                    "engine": "omnivoice",
                    "has_prompt": True,
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
        if settings.omnivoice_url:
            return self._compat.synthesize(text)

        return self._synthesize_local(text, voice_id)

    def _resolve_ref(self, voice_id: str | None) -> tuple[Path, str | None]:
        vid = (voice_id or "default").removeprefix("omnivoice:")
        voice_dir = settings.voices_dir / vid
        import json

        meta_path = voice_dir / "voice.json"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text())
            wav = voice_dir / meta.get("prompt_audio", "prompt.wav")
            return wav, meta.get("prompt_text")
        # fallback
        wav = settings.voices_dir / "default" / "prompt.wav"
        return wav, None

    def _synthesize_local(self, text: str, voice_id: str | None) -> SynthResult:
        from omnivoice import OmniVoice
        import torch

        if self._model is None:
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
            dtype = torch.float16 if device.startswith("cuda") else torch.float32
            self._model = OmniVoice.from_pretrained(
                settings.omnivoice_model or "k2-fsa/OmniVoice",
                device_map=device,
                dtype=dtype,
            )

        ref_audio, ref_text = self._resolve_ref(voice_id)
        if not ref_audio.exists():
            raise RuntimeError(f"OmniVoice needs a reference wav at {ref_audio}")

        kwargs = {"text": text, "ref_audio": str(ref_audio)}
        if ref_text:
            kwargs["ref_text"] = ref_text

        audio = self._model.generate(**kwargs)
        arr = np.asarray(audio, dtype=np.float32).reshape(-1)
        sr = 24000
        if hasattr(self._model, "sample_rate"):
            sr = int(self._model.sample_rate)
        buf = io.BytesIO()
        sf.write(buf, arr, sr, format="WAV", subtype="PCM_16")
        return SynthResult(buf.getvalue(), sr, "wav", "omnivoice")
