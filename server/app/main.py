from __future__ import annotations

import platform
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import __version__
from .config import settings
from .engines.edge import EdgeEngine
from .engines.editx import EditXEngine
from .engines.kokoro import KokoroEngine
from .engines.moss import MossEngine
from .engines.omnivoice import OmniVoiceEngine
from .engines.qwen3 import Qwen3Engine
from .engines.system import SystemTTSEngine
from .models import EMOTIONS, STYLES, HealthResponse, TTSRequest, VoicesResponse

edge_engine = EdgeEngine()
kokoro_engine = KokoroEngine()
editx_engine = EditXEngine()
moss_engine = MossEngine()
qwen3_engine = Qwen3Engine()
omnivoice_engine = OmniVoiceEngine()
system_engine = SystemTTSEngine()

ENGINE_MAP = {
    "edge": edge_engine,
    "kokoro": kokoro_engine,
    "editx": editx_engine,
    "moss": moss_engine,
    "qwen3": qwen3_engine,
    "omnivoice": omnivoice_engine,
    "system": system_engine,
}

PREFIX_TO_ENGINE = {
    "edge:": "edge",
    "kokoro:": "kokoro",
    "editx:": "editx",
    "moss:": "moss",
    "qwen3:": "qwen3",
    "omnivoice:": "omnivoice",
    "system:": "system",
}


def _available_engines() -> list[str]:
    return [name for name, eng in ENGINE_MAP.items() if eng.available()]


def resolve_engine(preferred: str | None = None, *, allow_fallback: bool = True):
    mode = preferred or settings.engine

    def pick(name: str):
        eng = ENGINE_MAP.get(name)
        if not eng:
            raise HTTPException(status_code=400, detail=f"Unknown engine: {name}")
        if not eng.available():
            raise HTTPException(status_code=503, detail=f"Engine '{name}' is not available on this machine.")
        # Edge needs network
        if name == "edge" and hasattr(eng, "probe_online") and not eng.probe_online():
            raise HTTPException(status_code=503, detail="Edge TTS offline (no internet)")
        return eng

    if mode != "auto":
        try:
            return pick(mode)
        except HTTPException:
            if not allow_fallback:
                raise
            # fall through to auto chain

    # auto / fallback chain — quality first when possible
    chain = [
        "edge",
        settings.fallback_engine,
        "kokoro",
        "qwen3",
        "moss",
        "omnivoice",
        "editx",
        "system",
    ]
    seen: set[str] = set()
    errors: list[str] = []
    for name in chain:
        if not name or name in seen or name == "auto":
            continue
        seen.add(name)
        try:
            return pick(name)
        except HTTPException as exc:
            errors.append(str(exc.detail))
            continue
    raise HTTPException(status_code=503, detail="; ".join(errors) or "No TTS engines available.")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    settings.voices_dir.mkdir(parents=True, exist_ok=True)
    if settings.engine in ("auto", "kokoro") and kokoro_engine.available():
        try:
            kokoro_engine.ensure_loaded()
            print("[listen] Kokoro ready")
        except Exception as exc:
            print(f"[listen] Kokoro warm-up deferred: {exc}")
    yield


app = FastAPI(title="Listen TTS Server", version=__version__, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    available = _available_engines()
    # Mark edge as available only if package present; online checked separately
    active = "none"
    msg = None
    try:
        active = resolve_engine().name
    except HTTPException as exc:
        msg = str(exc.detail)

    nice = {
        "edge": "Edge neural TTS ready (en-US-AriaNeural)",
        "kokoro": "Kokoro neural TTS ready (local)",
        "editx": "Step-Audio-EditX ready",
        "moss": "MOSS-TTS ready",
        "qwen3": "Qwen3-TTS ready",
        "omnivoice": "OmniVoice ready",
        "system": "System TTS fallback",
    }
    return HealthResponse(
        ok=bool(available),
        version=__version__,
        engine=active,
        engines_available=available,
        platform=platform.system(),
        message=msg or nice.get(active, active),
    )


@app.get("/v1/engines")
def engines() -> dict[str, Any]:
    out = []
    for name, eng in ENGINE_MAP.items():
        item = {
            "id": name,
            "available": eng.available(),
            "online": None,
            "label": {
                "edge": "Microsoft Edge (online neural)",
                "kokoro": "Kokoro (local neural)",
                "editx": "Step-Audio-EditX (local GPU)",
                "moss": "MOSS-TTS (local / remote)",
                "qwen3": "Qwen3-TTS (local / remote)",
                "omnivoice": "OmniVoice (local / remote)",
                "system": "System TTS (say / SAPI)",
            }.get(name, name),
        }
        if name == "edge" and eng.available():
            item["online"] = eng.probe_online()
        out.append(item)
    return {
        "engines": out,
        "preferred": settings.engine,
        "fallback": settings.fallback_engine,
        "default_voice_id": settings.default_voice_id,
    }


@app.get("/v1/voices", response_model=VoicesResponse)
def voices() -> VoicesResponse:
    items = []
    for name, eng in ENGINE_MAP.items():
        if not eng.available():
            continue
        if name == "edge" and not eng.probe_online():
            # still list curated Edge voices so UI can show them; synthesis will fall back
            items.extend(eng.list_voices()[:12])
            continue
        try:
            items.extend(eng.list_voices())
        except Exception:
            continue

    configured = settings.default_voice_id
    candidates = [
        configured,
        f"edge:{settings.edge_default_voice}",
        "edge:en-US-AriaNeural",
        f"kokoro:{settings.kokoro_default_voice}",
        "kokoro:af_heart",
    ]
    default = next((c for c in candidates if any(v["id"] == c for v in items)), None)
    if default is None and items:
        default = next((v["id"] for v in items if v["engine"] == "edge"), None) or items[0]["id"]

    return VoicesResponse(
        voices=items,
        default_voice_id=default or configured,
        emotions=EMOTIONS,
        styles=STYLES,
    )


@app.post("/v1/tts")
def tts(req: TTSRequest) -> Response:
    text = " ".join(req.text.split())
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    voice_id = req.voice_id
    preferred = req.engine
    if not preferred and voice_id:
        for prefix, name in PREFIX_TO_ENGINE.items():
            if voice_id.startswith(prefix):
                preferred = name
                break

    last_err: Exception | None = None
    result = None
    used = None

    attempts: list[str | None] = []
    if preferred:
        attempts.append(preferred)
    attempts.append(None)  # auto fallback chain

    for attempt in attempts:
        try:
            engine = resolve_engine(attempt, allow_fallback=attempt is None)
            vid = voice_id
            if not vid or not vid.startswith(f"{engine.name}:"):
                vid = _default_voice_for(engine.name)
            result = engine.synthesize(
                text,
                voice_id=vid,
                emotion=req.emotion,
                style=req.style,
                editx_speed=req.editx_speed,
                language_tag=req.language_tag,
                speed=req.speed,
            )
            used = engine.name
            break
        except Exception as exc:
            last_err = exc
            continue

    if result is None:
        raise HTTPException(status_code=500, detail=str(last_err) if last_err else "TTS failed")

    media = "audio/mpeg" if result.format == "mp3" else "audio/wav"
    return Response(
        content=result.audio,
        media_type=media,
        headers={
            "X-Listen-Engine": used or result.engine,
            "X-Listen-Sample-Rate": str(result.sample_rate),
            "X-Listen-Format": result.format,
            "Cache-Control": "no-store",
        },
    )


def _default_voice_for(engine: str) -> str:
    return {
        "edge": f"edge:{settings.edge_default_voice}",
        "kokoro": f"kokoro:{settings.kokoro_default_voice}",
        "system": "system:Samantha",
        "moss": "moss:default",
        "qwen3": "qwen3:Vivian",
        "omnivoice": "omnivoice:default",
        "editx": "editx:default",
    }.get(engine, settings.default_voice_id)


def run() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    run()
