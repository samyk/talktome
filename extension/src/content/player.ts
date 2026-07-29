import { TtsClient } from "../shared/audio-client";
import { SPEED_OPTIONS } from "../shared/settings";
import type { DocumentModel, PlayerSnapshot, PlaybackState, Settings } from "../shared/types";
import { highlightSentence } from "./extractor";

type Handlers = {
  onPlayPause: () => void;
  onStop: () => void;
  onSkip: (seconds: number) => void;
  onPrevSection: () => void;
  onNextSection: () => void;
  onSpeed: (speed: number) => void;
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
  private sectionsEl!: HTMLDivElement;
  private speedEl!: HTMLSelectElement;
  private sectionsOpen = false;

  constructor(private handlers: Handlers) {
    this.root = document.createElement("div");
    this.root.id = "listen-root";
    this.root.innerHTML = `
      <div class="listen-player" role="region" aria-label="Listen player">
        <div class="listen-row">
          <div class="listen-title">Listen</div>
          <div class="listen-meta">—</div>
          <button class="listen-btn" data-act="sections" title="Sections">§</button>
          <button class="listen-btn" data-act="save" title="Save to library">⤓</button>
          <button class="listen-btn danger" data-act="close" title="Close">✕</button>
        </div>
        <input class="listen-progress" type="range" min="0" max="1000" value="0" />
        <div class="listen-row">
          <button class="listen-btn" data-act="prev-sec" title="Previous section">⟸</button>
          <button class="listen-btn" data-act="back" title="Back 15s">−15</button>
          <button class="listen-btn primary" data-act="play" title="Play/Pause">▶</button>
          <button class="listen-btn" data-act="fwd" title="Forward 15s">+15</button>
          <button class="listen-btn" data-act="next-sec" title="Next section">⟹</button>
          <select class="listen-speed" title="Speed"></select>
        </div>
        <div class="listen-status">Ready</div>
        <div class="listen-sections"></div>
      </div>
    `;
    document.documentElement.appendChild(this.root);

    this.titleEl = this.root.querySelector(".listen-title")!;
    this.metaEl = this.root.querySelector(".listen-meta")!;
    this.statusEl = this.root.querySelector(".listen-status")!;
    this.progressEl = this.root.querySelector(".listen-progress")!;
    this.playBtn = this.root.querySelector('[data-act="play"]')!;
    this.sectionsEl = this.root.querySelector(".listen-sections")!;
    this.speedEl = this.root.querySelector(".listen-speed")!;

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
        this.handlers.onToggleSections();
      }
      if (act === "save") this.handlers.onSave();
      if (act === "close") this.handlers.onStop();
    });

    this.speedEl.addEventListener("change", () => {
      this.handlers.onSpeed(Number(this.speedEl.value));
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

  setSections(doc: DocumentModel, activeIndex: number) {
    this.sectionsEl.innerHTML = "";
    doc.sections.forEach((sec, i) => {
      const btn = document.createElement("button");
      btn.className = `listen-section-item${i === activeIndex ? " active" : ""}`;
      btn.textContent = `${"  ".repeat(Math.max(0, sec.level - 1))}${sec.title}`;
      btn.addEventListener("click", () => this.handlers.onSection(i));
      this.sectionsEl.appendChild(btn);
    });
  }

  update(snapshot: PlayerSnapshot) {
    this.titleEl.textContent = snapshot.title || "Listen";
    this.metaEl.textContent = `${snapshot.speed}× · sec ${snapshot.sectionIndex + 1}`;
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

/** Sequential TTS playback with sentence highlighting + prefetch. */
export class PlaybackController {
  private audio = new Audio();
  private state: PlaybackState = "idle";
  private sentenceIndex = 0;
  private sectionIndex = 0;
  private doc: DocumentModel | null = null;
  private settings!: Settings;
  private client!: TtsClient;
  private cache = new Map<number, { url: string; engine: string }>();
  private prefetching = new Set<number>();
  private wordTimer: number | null = null;
  private destroyed = false;
  private onChange: (s: PlayerSnapshot) => void;
  private lastEngine = "unknown";

  constructor(onChange: (s: PlayerSnapshot) => void) {
    this.onChange = onChange;
    this.audio.preload = "auto";
    this.audio.addEventListener("ended", () => void this.advance());
    this.audio.addEventListener("timeupdate", () => this.onTimeUpdate());
  }

  configure(settings: Settings) {
    this.settings = settings;
    this.client = TtsClient.fromSettings(settings);
    this.audio.playbackRate = settings.speed;
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
    };
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
    this.settings.speed = speed;
    // Invalidate cache — speed may be baked into Edge/Kokoro audio
    this.clearCache();
    if (this.lastEngine === "edge" || this.lastEngine === "kokoro") {
      this.audio.playbackRate = 1;
      void this.playCurrent();
    } else {
      this.audio.playbackRate = speed;
    }
    this.emit();
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
      const { url, engine } = await this.getAudioUrl(this.sentenceIndex);
      this.lastEngine = engine;
      void this.prefetchAround(this.sentenceIndex);
      this.audio.src = url;
      // Edge/Kokoro bake speed server-side — don't double-apply
      this.audio.playbackRate = engine === "edge" || engine === "kokoro" ? 1 : this.settings.speed;
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

  private async getAudioUrl(index: number): Promise<{ url: string; engine: string }> {
    const cached = this.cache.get(index);
    if (cached) return cached;
    const sentence = this.doc!.flatSentences[index];
    const { buffer, engine, format } = await this.client.synthesize(sentence.text, {
      voiceId: this.settings.voiceId || undefined,
      engine: this.settings.engine,
      emotion: this.settings.emotion,
      style: this.settings.style,
      speed: this.settings.speed,
    });
    const mime = format === "mp3" ? "audio/mpeg" : "audio/wav";
    const blob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const entry = { url, engine };
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

  destroy() {
    this.destroyed = true;
    this.stop();
  }
}
