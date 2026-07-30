import { TtsClient, type VoiceInfo } from "../shared/audio-client";
import { type ServerCatalog, engineOptionLabel, voicesForEngine } from "../shared/catalog";
import { SPEED_OPTIONS } from "../shared/settings";
import type {
  DocumentModel,
  EngineId,
  PlayerSnapshot,
  PlaybackState,
  Settings,
} from "../shared/types";
import { highlightSentence } from "./extractor";

type Handlers = {
  onPlayPause: () => void;
  onStop: () => void;
  onSkip: (seconds: number) => void;
  onPrevSection: () => void;
  onNextSection: () => void;
  onSpeed: (speed: number) => void;
  onEngine: (engine: EngineId) => void;
  onVoice: (voiceId: string) => void;
  onSection: (sectionIndex: number) => void;
  onToggleSections: () => void;
  onSave: () => void;
};

export class PlayerUI {
  root: HTMLDivElement;
  private titleEl!: HTMLElement;
  private metaEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private progressEl!: HTMLInputElement;
  private playBtn!: HTMLButtonElement;
  private chaptersBtn!: HTMLButtonElement;
  private sectionNavBtns!: HTMLButtonElement[];
  private sectionsEl!: HTMLDivElement;
  private speedEl!: HTMLSelectElement;
  private engineEl!: HTMLSelectElement;
  private voiceEl!: HTMLSelectElement;
  private sectionsOpen = false;
  private catalogVoices: VoiceInfo[] = [];

  constructor(private handlers: Handlers) {
    this.root = document.createElement("div");
    this.root.id = "listen-root";
    this.root.innerHTML = `
      <div class="listen-player" role="region" aria-label="TalkToMe player">
        <div class="listen-row">
          <div class="listen-title">TalkToMe</div>
          <div class="listen-meta">—</div>
          <button class="listen-btn" data-act="sections" title="Chapters" hidden>☰</button>
          <button class="listen-btn" data-act="save" title="Save to library">⤓</button>
          <button class="listen-btn danger" data-act="close" title="Close">✕</button>
        </div>
        <input class="listen-progress" type="range" min="0" max="1000" value="0" />
        <div class="listen-row">
          <button class="listen-btn" data-act="prev-sec" title="Previous chapter" hidden>⟸</button>
          <button class="listen-btn" data-act="back" title="Back 15s">−15</button>
          <button class="listen-btn primary" data-act="play" title="Play/Pause">▶</button>
          <button class="listen-btn" data-act="fwd" title="Forward 15s">+15</button>
          <button class="listen-btn" data-act="next-sec" title="Next chapter" hidden>⟹</button>
          <div class="listen-status">Ready</div>
        </div>
        <div class="listen-sections"></div>
        <div class="listen-controls">
          <label class="listen-field">
            <span>Engine</span>
            <select class="listen-select listen-engine" title="Engine"></select>
          </label>
          <label class="listen-field">
            <span>Voice</span>
            <select class="listen-select listen-voice" title="Voice"></select>
          </label>
          <label class="listen-field">
            <span>Speed</span>
            <select class="listen-select listen-speed" title="Speed"></select>
          </label>
        </div>
      </div>
    `;
    document.documentElement.appendChild(this.root);

    this.titleEl = this.root.querySelector(".listen-title")!;
    this.metaEl = this.root.querySelector(".listen-meta")!;
    this.statusEl = this.root.querySelector(".listen-status")!;
    this.progressEl = this.root.querySelector(".listen-progress")!;
    this.playBtn = this.root.querySelector('[data-act="play"]')!;
    this.chaptersBtn = this.root.querySelector('[data-act="sections"]')!;
    this.sectionNavBtns = [
      this.root.querySelector('[data-act="prev-sec"]')!,
      this.root.querySelector('[data-act="next-sec"]')!,
    ];
    this.sectionsEl = this.root.querySelector(".listen-sections")!;
    this.speedEl = this.root.querySelector(".listen-speed")!;
    this.engineEl = this.root.querySelector(".listen-engine")!;
    this.voiceEl = this.root.querySelector(".listen-voice")!;

    for (const s of SPEED_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = String(s);
      opt.textContent = `${s}×`;
      this.speedEl.appendChild(opt);
    }

    this.root.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "play") this.handlers.onPlayPause();
      if (act === "back") this.handlers.onSkip(-15);
      if (act === "fwd") this.handlers.onSkip(15);
      if (act === "prev-sec") this.handlers.onPrevSection();
      if (act === "next-sec") this.handlers.onNextSection();
      if (act === "sections") {
        this.sectionsOpen = !this.sectionsOpen;
        this.sectionsEl.classList.toggle("open", this.sectionsOpen);
        this.chaptersBtn.classList.toggle("active", this.sectionsOpen);
        this.handlers.onToggleSections();
      }
      if (act === "save") this.handlers.onSave();
      if (act === "close") this.handlers.onStop();
    });

    this.speedEl.addEventListener("change", () => {
      this.handlers.onSpeed(Number(this.speedEl.value));
    });

    this.engineEl.addEventListener("change", () => {
      const engine = this.engineEl.value as EngineId;
      this.fillVoices(engine, this.voiceEl.value);
      this.handlers.onEngine(engine);
      this.handlers.onVoice(this.voiceEl.value);
    });

    this.voiceEl.addEventListener("change", () => {
      this.handlers.onVoice(this.voiceEl.value);
    });

    this.progressEl.addEventListener("input", () => {
      // Scrub by sentence ratio — controller interprets via custom event
      this.root.dispatchEvent(
        new CustomEvent("listen-seek-ratio", {
          detail: Number(this.progressEl.value) / 1000,
        }),
      );
    });
  }

  setDock(dock: Settings["playerDock"]) {
    this.root.classList.remove("listen-dock-top", "listen-dock-floating");
    if (dock === "top") this.root.classList.add("listen-dock-top");
    if (dock === "floating") this.root.classList.add("listen-dock-floating");
  }

  /** Fill the engine/voice pickers from the cached server catalog. */
  setCatalog(catalog: ServerCatalog, settings: Settings) {
    this.catalogVoices = catalog.voices.voices;

    this.engineEl.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "auto";
    auto.textContent = "Auto (best available)";
    this.engineEl.appendChild(auto);
    for (const engine of catalog.engines.engines) {
      const opt = document.createElement("option");
      opt.value = engine.id;
      opt.textContent = engineOptionLabel(engine);
      opt.disabled = !engine.available && engine.id !== "edge";
      this.engineEl.appendChild(opt);
    }
    this.engineEl.value = settings.engine || "auto";
    this.fillVoices(this.engineEl.value as EngineId, settings.voiceId);
  }

  private fillVoices(engine: EngineId, selected: string) {
    if (!this.catalogVoices.length) return;
    const list = voicesForEngine(this.catalogVoices, engine);
    this.voiceEl.innerHTML = "";
    for (const voice of list) {
      const opt = document.createElement("option");
      opt.value = voice.id;
      opt.textContent = voice.name;
      this.voiceEl.appendChild(opt);
    }
    if (list.some((v) => v.id === selected)) this.voiceEl.value = selected;
    else if (list[0]) this.voiceEl.value = list[0].id;
  }

  setSections(doc: DocumentModel, activeIndex: number) {
    this.sectionsEl.innerHTML = "";
    doc.sections.forEach((sec, i) => {
      const btn = document.createElement("button");
      btn.className = `listen-section-item${i === activeIndex ? " active" : ""}`;
      btn.textContent = `${"  ".repeat(Math.max(0, sec.level - 1))}${sec.title}`;
      btn.addEventListener("click", () => this.handlers.onSection(i));
      this.sectionsEl.appendChild(btn);
    });

    // One "chapter" is just the whole page, so the controls would be no-ops.
    const hasChapters = doc.sections.length > 1;
    this.chaptersBtn.hidden = !hasChapters;
    for (const btn of this.sectionNavBtns) btn.hidden = !hasChapters;
    if (!hasChapters && this.sectionsOpen) {
      this.sectionsOpen = false;
      this.sectionsEl.classList.remove("open");
      this.chaptersBtn.classList.remove("active");
    }
  }

  update(snapshot: PlayerSnapshot) {
    this.titleEl.textContent = snapshot.title || "TalkToMe";
    this.metaEl.textContent = snapshot.engine ? `${snapshot.engine} · ${snapshot.speed}×` : `${snapshot.speed}×`;
    this.progressEl.value = String(Math.round(snapshot.progress * 1000));
    this.speedEl.value = String(snapshot.speed);
    this.playBtn.textContent = snapshot.state === "playing" ? "❚❚" : "▶";
    if (snapshot.state === "loading") {
      this.statusEl.textContent = "Synthesizing…";
      this.statusEl.classList.remove("error");
    } else if (snapshot.state === "error") {
      this.statusEl.textContent = snapshot.error || "Error";
      this.statusEl.classList.add("error");
    } else if (snapshot.state === "playing") {
      this.statusEl.textContent = "Playing";
      this.statusEl.classList.remove("error");
    } else if (snapshot.state === "paused") {
      this.statusEl.textContent = "Paused";
      this.statusEl.classList.remove("error");
    } else {
      this.statusEl.textContent = "Ready";
      this.statusEl.classList.remove("error");
    }
  }

  destroy() {
    this.root.remove();
  }
}

interface CacheEntry {
  url: string;
  engine: string;
  speedApplied: number;
}

const SYNTHESIS_KEYS = ["engine", "voiceId", "emotion", "style", "speed", "serverUrl"] as const;

function affectsSynthesis(a: Settings, b: Settings): boolean {
  return SYNTHESIS_KEYS.some((key) => a[key] !== b[key]);
}

/** Sequential TTS playback with sentence highlighting + prefetch. */
export class PlaybackController {
  private audio = new Audio();
  private state: PlaybackState = "idle";
  private sentenceIndex = 0;
  private sectionIndex = 0;
  private doc: DocumentModel | null = null;
  private settings!: Settings;
  private client!: TtsClient;
  private cache = new Map<number, CacheEntry>();
  private prefetching = new Set<number>();
  private wordTimer: number | null = null;
  private destroyed = false;
  private onChange: (s: PlayerSnapshot) => void;
  private lastEngine = "unknown";
  /** Bumped whenever synthesis parameters change, to strand in-flight fetches. */
  private epoch = 0;

  constructor(onChange: (s: PlayerSnapshot) => void) {
    this.onChange = onChange;
    this.audio.preload = "auto";
    this.audio.addEventListener("ended", () => void this.advance());
    this.audio.addEventListener("timeupdate", () => this.onTimeUpdate());
  }

  configure(settings: Settings) {
    const previous = this.settings;
    this.settings = settings;
    this.client = TtsClient.fromSettings(settings);
    if (previous && affectsSynthesis(previous, settings)) {
      this.invalidateCache();
      if (this.state === "playing" || this.state === "paused") void this.playCurrent();
      return;
    }
    this.applyPlaybackRate();
  }

  snapshot(): PlayerSnapshot {
    const total = this.doc?.flatSentences.length || 1;
    return {
      state: this.state,
      speed: this.settings?.speed ?? 1,
      sectionIndex: this.sectionIndex,
      sentenceIndex: this.sentenceIndex,
      progress: this.sentenceIndex / total,
      title: this.doc?.title,
      engine: this.lastEngine === "unknown" ? undefined : this.lastEngine,
    };
  }

  /**
   * Speed is baked into the audio by some engines and not others, so the
   * residual is what's left for the element. Applying the full multiplier on
   * top of pre-sped audio squares it.
   */
  private applyPlaybackRate(speedApplied?: number) {
    const applied = speedApplied ?? this.cache.get(this.sentenceIndex)?.speedApplied ?? 1;
    const residual = (this.settings?.speed ?? 1) / (applied || 1);
    this.audio.playbackRate = Math.min(4, Math.max(0.25, residual));
  }

  private emit(extra: Partial<PlayerSnapshot> = {}) {
    this.onChange({ ...this.snapshot(), ...extra });
  }

  async load(doc: DocumentModel, startSentence = 0) {
    this.stopAudio();
    this.clearCache();
    this.doc = doc;
    this.sentenceIndex = Math.max(0, Math.min(startSentence, doc.flatSentences.length - 1));
    this.sectionIndex = this.sectionForSentence(this.sentenceIndex);
    this.state = "loading";
    this.emit();
    await this.playCurrent();
  }

  async toggle() {
    if (this.state === "playing") {
      this.audio.pause();
      this.state = "paused";
      this.emit();
      return;
    }
    if (this.state === "paused") {
      await this.audio.play();
      this.state = "playing";
      this.emit();
      return;
    }
    if (this.doc) await this.playCurrent();
  }

  pause() {
    this.audio.pause();
    if (this.state === "playing") {
      this.state = "paused";
      this.emit();
    }
  }

  async resume() {
    if (this.state === "paused") {
      await this.audio.play();
      this.state = "playing";
      this.emit();
    }
  }

  stop() {
    this.stopAudio();
    this.clearCache();
    highlightSentence(null);
    this.state = "idle";
    this.emit();
  }

  setSpeed(speed: number) {
    const bakedIn = (this.cache.get(this.sentenceIndex)?.speedApplied ?? 1) !== 1;
    this.settings.speed = speed;
    if (!bakedIn) {
      // Audio is speed-agnostic, so retune playback and keep the cache warm.
      this.applyPlaybackRate(1);
      this.emit();
      return;
    }
    this.invalidateCache();
    this.emit();
    void this.playCurrent();
  }

  setEngine(engine: EngineId) {
    if (this.settings.engine === engine) return;
    this.settings.engine = engine;
    this.invalidateCache();
    this.emit();
    if (this.state !== "idle") void this.playCurrent();
  }

  setVoice(voiceId: string) {
    if (this.settings.voiceId === voiceId) return;
    this.settings.voiceId = voiceId;
    this.invalidateCache();
    this.emit();
    if (this.state !== "idle") void this.playCurrent();
  }

  async skip(seconds: number) {
    if (!this.doc) return;
    // Approximate: average sentence ~3s at 1x
    const delta = Math.round(seconds / 3);
    await this.seekSentence(this.sentenceIndex + delta);
  }

  async nextSection() {
    if (!this.doc) return;
    const next = Math.min(this.doc.sections.length - 1, this.sectionIndex + 1);
    await this.seekSection(next);
  }

  async prevSection() {
    if (!this.doc) return;
    const prev = Math.max(0, this.sectionIndex - 1);
    await this.seekSection(prev);
  }

  async seekSection(index: number) {
    if (!this.doc) return;
    const sec = this.doc.sections[index];
    if (!sec) return;
    await this.seekSentence(sec.startIndex);
  }

  async seekSentence(index: number) {
    if (!this.doc) return;
    this.stopAudio(false);
    this.sentenceIndex = Math.max(0, Math.min(index, this.doc.flatSentences.length - 1));
    this.sectionIndex = this.sectionForSentence(this.sentenceIndex);
    await this.playCurrent();
  }

  async seekRatio(ratio: number) {
    if (!this.doc) return;
    const idx = Math.floor(ratio * this.doc.flatSentences.length);
    await this.seekSentence(idx);
  }

  private sectionForSentence(index: number): number {
    if (!this.doc) return 0;
    return Math.max(
      0,
      this.doc.sections.findIndex((s) => index >= s.startIndex && index <= s.endIndex),
    );
  }

  private async playCurrent() {
    if (!this.doc || this.destroyed) return;
    const sentence = this.doc.flatSentences[this.sentenceIndex];
    if (!sentence) {
      this.state = "idle";
      highlightSentence(null);
      this.emit();
      return;
    }

    this.sectionIndex = this.sectionForSentence(this.sentenceIndex);
    highlightSentence(sentence.id, sentence.words[0]?.id ?? null);
    this.state = "loading";
    this.emit();

    try {
      const { url, engine, speedApplied } = await this.getAudioUrl(this.sentenceIndex);
      this.lastEngine = engine;
      void this.prefetchAround(this.sentenceIndex);
      this.audio.src = url;
      this.applyPlaybackRate(speedApplied);
      await this.audio.play();
      this.state = "playing";
      this.emit();
      this.scheduleWordHighlights(sentence);
    } catch (err) {
      this.state = "error";
      this.emit({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  private scheduleWordHighlights(sentence: (DocumentModel["flatSentences"])[number]) {
    if (this.wordTimer) window.clearInterval(this.wordTimer);
    if (this.settings.highlightMode === "sentence" || this.settings.highlightMode === "paragraph") {
      return;
    }
    const words = sentence.words;
    if (!words.length) return;
    this.wordTimer = window.setInterval(() => {
      if (!this.audio.duration || Number.isNaN(this.audio.duration)) return;
      const t = this.audio.currentTime / this.audio.duration;
      // Weight by character length
      const weights = words.map((w) => Math.max(1, w.text.replace(/[^\w\u00C0-\u024F]/g, "").length));
      const total = weights.reduce((a, b) => a + b, 0);
      let acc = 0;
      let idx = 0;
      for (let i = 0; i < weights.length; i++) {
        acc += weights[i] / total;
        if (t <= acc) {
          idx = i;
          break;
        }
        idx = i;
      }
      highlightSentence(sentence.id, words[idx]?.id ?? null);
    }, 50);
  }

  private onTimeUpdate() {
    if (!this.doc) return;
    const total = this.doc.flatSentences.length || 1;
    const local = this.audio.duration ? this.audio.currentTime / this.audio.duration : 0;
    this.emit({ progress: (this.sentenceIndex + local) / total });
  }

  private async advance() {
    if (!this.doc) return;
    if (this.sentenceIndex >= this.doc.flatSentences.length - 1) {
      this.state = "idle";
      highlightSentence(null);
      this.emit();
      return;
    }
    this.sentenceIndex += 1;
    await this.playCurrent();
  }

  private async getAudioUrl(index: number): Promise<CacheEntry> {
    const cached = this.cache.get(index);
    if (cached) return cached;
    const epoch = this.epoch;
    const sentence = this.doc!.flatSentences[index];
    const { buffer, engine, format, speedApplied } = await this.client.synthesize(sentence.text, {
      voiceId: this.settings.voiceId || undefined,
      engine: this.settings.engine,
      emotion: this.settings.emotion,
      style: this.settings.style,
      speed: this.settings.speed,
    });
    const mime = format === "mp3" ? "audio/mpeg" : "audio/wav";
    const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
    const entry: CacheEntry = { url, engine, speedApplied };
    // Settings changed while this was in flight: the audio is stale, and
    // caching it would resurrect the old voice or speed a few sentences later.
    if (epoch !== this.epoch) {
      URL.revokeObjectURL(url);
      return entry;
    }
    this.cache.set(index, entry);
    return entry;
  }

  private async prefetchAround(index: number) {
    const targets = [index + 1, index + 2].filter(
      (i) => this.doc && i < this.doc.flatSentences.length && !this.cache.has(i) && !this.prefetching.has(i),
    );
    for (const i of targets) {
      this.prefetching.add(i);
      void this.getAudioUrl(i)
        .catch(() => undefined)
        .finally(() => this.prefetching.delete(i));
    }
  }

  private stopAudio(clearSrc = true) {
    if (this.wordTimer) {
      window.clearInterval(this.wordTimer);
      this.wordTimer = null;
    }
    this.audio.pause();
    if (clearSrc) {
      this.audio.removeAttribute("src");
      this.audio.load();
    }
  }

  private clearCache() {
    for (const { url } of this.cache.values()) URL.revokeObjectURL(url);
    this.cache.clear();
  }

  /** Drop cached audio and strand in-flight prefetches from the old settings. */
  private invalidateCache() {
    this.epoch += 1;
    this.prefetching.clear();
    this.clearCache();
  }

  destroy() {
    this.destroyed = true;
    this.stop();
  }
}
