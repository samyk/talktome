from __future__ import annotations

import hashlib
import io
import json
import sys
from pathlib import Path

import soundfile as sf

from ..config import settings
from ..models import VoiceInfo
from .base import SynthResult, TTSEngine


class EditXEngine(TTSEngine):
    """Wraps Step-Audio-EditX zero-shot clone (+ optional emotion/style edits)."""

    name = "editx"

    def __init__(self) -> None:
        self._model = None
        self._load_error: str | None = None
        self._voices: list[VoiceInfo] = []
        self._scan_voices()

    def _scan_voices(self) -> None:
        voices_dir = settings.voices_dir
        voices_dir.mkdir(parents=True, exist_ok=True)
        found: list[VoiceInfo] = []
        for meta_path in sorted(voices_dir.glob("*/voice.json")):
            try:
                meta = json.loads(meta_path.read_text())
                wav = meta_path.parent / meta.get("prompt_audio", "prompt.wav")
                if not wav.exists():
                    continue
                found.append(
                    VoiceInfo(
                        id=f"editx:{meta.get('id', meta_path.parent.name)}",
                        name=meta.get("name", meta_path.parent.name),
                        language=meta.get("language", "en"),
                        engine="editx",
                        style_hint=meta.get("style_hint"),
                        has_prompt=True,
                    )
                )
            except Exception:
                continue
        if not found:
            # Placeholder — user must add a reference wav under voices/
            found.append(
                VoiceInfo(
                    id="editx:default",
                    name="EditX Default (add voices/*/voice.json)",
                    language="en",
                    engine="editx",
                    has_prompt=False,
                )
            )
        self._voices = found

    def available(self) -> bool:
        if settings.editx_model_path is None:
            return False
        if not Path(settings.editx_model_path).exists():
            return False
        if settings.editx_repo and Path(settings.editx_repo).exists():
            return True
        # Allow importing if user already has editx on PYTHONPATH
        try:
            import tts  # noqa: F401

            return True
        except Exception:
            return settings.editx_repo is not None

    def ensure_loaded(self) -> None:
        if self._model is not None:
            return
        if self._load_error:
            raise RuntimeError(self._load_error)

        repo = settings.editx_repo
        if repo:
            repo_s = str(Path(repo).resolve())
            if repo_s not in sys.path:
                sys.path.insert(0, repo_s)

        try:
            from tokenizer import StepAudioTokenizer
            from tts import StepAudioTTS
        except Exception as exc:
            self._load_error = (
                f"Failed to import Step-Audio-EditX ({exc}). "
                "Set LISTEN_EDITX_REPO to the cloned repo path."
            )
            raise RuntimeError(self._load_error) from exc

        model_path = str(settings.editx_model_path)
        tokenizer_path = str(settings.editx_tokenizer_path) if settings.editx_tokenizer_path else None
        try:
            tokenizer = StepAudioTokenizer(
                tokenizer_path,
                model_source=settings.editx_model_source,
            )
            self._model = StepAudioTTS(
                model_path,
                tokenizer,
                model_source=settings.editx_model_source,
                quantization=settings.editx_quantization,
                gpu_memory_utilization=settings.editx_gpu_memory_utilization,
                max_model_len=settings.editx_max_model_len,
                enforce_eager=True,
                dtype=settings.editx_dtype,
                max_num_seqs=1,
                cosyvoice_dtype=settings.editx_cosyvoice_dtype,
                cosyvoice_cuda_graph=not settings.editx_no_cuda_graph,
            )
        except Exception as exc:
            self._load_error = f"Failed to load Step-Audio-EditX: {exc}"
            raise RuntimeError(self._load_error) from exc

    def list_voices(self) -> list[dict]:
        self._scan_voices()
        return [v.model_dump() for v in self._voices]

    def _resolve_prompt(self, voice_id: str | None) -> tuple[Path, str]:
        vid = (voice_id or settings.default_voice_id).removeprefix("editx:")
        voice_dir = settings.voices_dir / vid
        meta_path = voice_dir / "voice.json"
        if not meta_path.exists():
            # try default folder
            voice_dir = settings.voices_dir / "default"
            meta_path = voice_dir / "voice.json"
        if not meta_path.exists():
            raise RuntimeError(
                f"No EditX voice prompt for '{vid}'. "
                f"Create {settings.voices_dir}/<id>/voice.json + prompt.wav"
            )
        meta = json.loads(meta_path.read_text())
        wav = voice_dir / meta.get("prompt_audio", "prompt.wav")
        text = meta.get("prompt_text", "")
        if not wav.exists() or not text:
            raise RuntimeError(f"Invalid voice package at {voice_dir}")
        return wav, text

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
        _ = speed
        self.ensure_loaded()
        assert self._model is not None

        prompt_wav, prompt_text = self._resolve_prompt(voice_id)
        target = text.strip()
        if language_tag and not target.startswith("["):
            target = f"{language_tag}{target}"

        # Cache key
        cache_key = None
        if settings.cache_enabled:
            settings.cache_dir.mkdir(parents=True, exist_ok=True)
            raw = "|".join(
                [
                    target,
                    str(prompt_wav),
                    prompt_text,
                    emotion or "",
                    style or "",
                    editx_speed or "",
                ]
            )
            cache_key = hashlib.sha256(raw.encode()).hexdigest()
            cache_path = settings.cache_dir / f"{cache_key}.wav"
            if cache_path.exists():
                audio_bytes = cache_path.read_bytes()
                info = sf.info(io.BytesIO(audio_bytes))
                return SynthResult(audio_bytes, int(info.samplerate), "wav", "editx")

        output_audio, output_sr = self._model.clone(
            prompt_wav_path=str(prompt_wav),
            prompt_text=prompt_text,
            target_text=target,
        )

        # Optional post-clone expressive edits
        tmp_path = settings.cache_dir / f"_tmp_{cache_key or 'live'}.wav"
        settings.cache_dir.mkdir(parents=True, exist_ok=True)
        import torchaudio

        torchaudio.save(str(tmp_path), output_audio.cpu(), output_sr)
        working_wav = tmp_path
        working_text = target

        for edit_type, edit_info in (
            ("emotion", emotion),
            ("style", style),
            ("speed", editx_speed),
        ):
            if not edit_info:
                continue
            output_audio, output_sr = self._model.edit(
                prompt_wav_path=str(working_wav),
                prompt_text=working_text,
                edit_type=edit_type,
                edit_info=edit_info,
            )
            torchaudio.save(str(working_wav), output_audio.cpu(), output_sr)

        buf = io.BytesIO()
        # torchaudio tensor -> numpy via soundfile
        audio_np = output_audio.squeeze().detach().cpu().numpy()
        sf.write(buf, audio_np, int(output_sr), format="WAV")
        audio_bytes = buf.getvalue()

        if cache_key:
            (settings.cache_dir / f"{cache_key}.wav").write_bytes(audio_bytes)
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

        return SynthResult(audio_bytes, int(output_sr), "wav", "editx")
