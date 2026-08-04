export type PlaybackState = "idle" | "loading" | "playing" | "paused" | "error";

export type EngineId =
  | "auto"
  | "edge"
  | "kokoro"
  | "editx"
  | "moss"
  | "qwen3"
  | "omnivoice"
  | "system";

export interface Settings {
  serverUrl: string;
  engine: EngineId;
  voiceId: string;
  speed: number;
  emotion: string | null;
  style: string | null;
  autoScroll: boolean;
  highlightMode: "word" | "sentence" | "paragraph";
  skipNavChrome: boolean;
  /** Floating TalkToMe chip when selecting text. Off by default — use shortcuts / context menu. */
  selectionChip: boolean;
  playerDock: "bottom" | "top" | "floating";
  theme: "auto" | "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "http://127.0.0.1:8765",
  engine: "auto",
  voiceId: "edge:en-US-AriaNeural",
  speed: 1,
  emotion: null,
  style: null,
  autoScroll: true,
  highlightMode: "sentence",
  skipNavChrome: true,
  selectionChip: false,
  playerDock: "bottom",
  theme: "auto",
};

export interface WordUnit {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface SentenceUnit {
  id: string;
  text: string;
  words: WordUnit[];
  elementId: string;
}

export interface ParagraphUnit {
  id: string;
  text: string;
  sentences: SentenceUnit[];
  elementId: string;
}

export interface SectionUnit {
  id: string;
  title: string;
  level: number;
  paragraphs: ParagraphUnit[];
  startIndex: number;
  endIndex: number;
}

export interface DocumentModel {
  title: string;
  url: string;
  sections: SectionUnit[];
  flatSentences: SentenceUnit[];
  flatParagraphs: ParagraphUnit[];
}

export interface PlayerSnapshot {
  state: PlaybackState;
  speed: number;
  sectionIndex: number;
  sentenceIndex: number;
  progress: number;
  error?: string;
  title?: string;
  /** Engine that served the current sentence, once known. */
  engine?: string;
}

export type ExtensionMessage =
  | { type: "PING" }
  | { type: "GET_SETTINGS" }
  | { type: "SETTINGS_UPDATED"; settings: Settings }
  | { type: "PLAY_PAGE" }
  | { type: "PLAY_SELECTION" }
  | { type: "TOGGLE_PLAY" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "STOP" }
  | { type: "SET_SPEED"; speed: number }
  | { type: "NEXT_SECTION" }
  | { type: "PREV_SECTION" }
  | { type: "SKIP"; seconds: number }
  | { type: "SEEK_SENTENCE"; sentenceIndex: number }
  | { type: "PLAYER_STATE"; snapshot: PlayerSnapshot }
  | { type: "GET_PLAYER_STATE" }
  | { type: "SAVE_TO_LIBRARY" }
  | { type: "SERVER_STATUS" };

export interface LibraryItem {
  id: string;
  title: string;
  url: string;
  savedAt: number;
  excerpt: string;
  text: string;
  sections: { title: string; text: string }[];
}
