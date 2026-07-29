from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

EngineName = Literal[
    "auto",
    "edge",
    "kokoro",
    "editx",
    "moss",
    "qwen3",
    "omnivoice",
    "system",
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LISTEN_",
        env_file=".env",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = 8765
    cors_origins: list[str] = ["*"]

    # Preferred engine. "auto" = edge (if online) → kokoro → others → system
    engine: EngineName = "auto"
    fallback_engine: EngineName = "kokoro"

    # Defaults
    default_voice_id: str = "edge:en-US-AriaNeural"
    kokoro_default_voice: str = "af_heart"
    edge_default_voice: str = "en-US-AriaNeural"

    # Step-Audio-EditX
    editx_repo: Path | None = None
    editx_model_path: Path | None = None
    editx_tokenizer_path: Path | None = None
    editx_model_source: str = "local"
    editx_quantization: str | None = "awq"
    editx_gpu_memory_utilization: float = 0.5
    editx_max_model_len: int = 3072
    editx_dtype: str = "bfloat16"
    editx_cosyvoice_dtype: str = "bfloat16"
    editx_no_cuda_graph: bool = True

    # MOSS-TTS
    moss_url: str | None = None  # e.g. http://127.0.0.1:8000/v1
    moss_api_key: str | None = None
    moss_model: str = "moss-tts"
    moss_voice: str = "default"
    moss_model_path: str | None = None
    moss_ref_audio: Path | None = None

    # Qwen3-TTS
    qwen3_url: str | None = None
    qwen3_api_key: str | None = None
    qwen3_model: str = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
    qwen3_model_path: str | None = None
    qwen3_voice: str = "Vivian"

    # OmniVoice
    omnivoice_url: str | None = None
    omnivoice_api_key: str | None = None
    omnivoice_model: str = "k2-fsa/OmniVoice"

    voices_dir: Path = Path(__file__).resolve().parent.parent / "voices"
    cache_dir: Path = Path.home() / ".cache" / "listen-tts"
    cache_enabled: bool = True
    max_chars_per_request: int = 420


settings = Settings()
