from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class SynthResult:
    audio: bytes
    sample_rate: int
    format: str = "wav"
    engine: str = "unknown"
    #: Speed multiplier already baked into ``audio``. The client divides its
    #: target speed by this to get the residual playbackRate, so an engine that
    #: ignores ``speed`` must leave it at 1.0 or playback ends up squared.
    speed_applied: float = 1.0


class TTSEngine(ABC):
    name: str

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def list_voices(self) -> list[dict]: ...

    @abstractmethod
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
    ) -> SynthResult: ...
