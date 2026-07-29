from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

EngineLiteral = Literal["edge", "kokoro", "editx", "moss", "qwen3", "omnivoice", "system"]


class VoiceInfo(BaseModel):
    id: str
    name: str
    language: str = "en"
    engine: EngineLiteral
    style_hint: str | None = None
    has_prompt: bool = False


class HealthResponse(BaseModel):
    ok: bool
    version: str
    engine: str
    engines_available: list[str]
    platform: str
    message: str | None = None


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)
    voice_id: str | None = None
    engine: EngineLiteral | None = None
    emotion: str | None = None
    style: str | None = None
    # Playback speed multiplier (1.0 = normal). Edge maps this to --rate.
    speed: float | None = Field(default=None, ge=0.5, le=4.5)
    editx_speed: Literal["faster", "slower", "more faster", "more slower"] | None = None
    language_tag: str | None = None
    format: Literal["wav", "mp3"] = "wav"


class VoicesResponse(BaseModel):
    voices: list[VoiceInfo]
    default_voice_id: str
    emotions: list[str]
    styles: list[str]


EMOTIONS = [
    "happy",
    "angry",
    "sad",
    "humour",
    "confusion",
    "disgusted",
    "empathy",
    "embarrass",
    "fear",
    "surprised",
    "excited",
    "depressed",
    "coldness",
    "admiration",
]

STYLES = [
    "serious",
    "arrogant",
    "child",
    "older",
    "girl",
    "pure",
    "sister",
    "sweet",
    "ethereal",
    "whisper",
    "gentle",
    "recite",
    "generous",
    "act_coy",
    "warm",
    "shy",
    "comfort",
    "authority",
    "chat",
    "radio",
    "soulful",
    "story",
    "vivid",
    "program",
    "news",
    "advertising",
    "roar",
    "murmur",
    "shout",
    "deeply",
    "loudly",
    "exaggerated",
]
