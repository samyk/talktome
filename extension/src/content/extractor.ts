import type {
  DocumentModel,
  ParagraphUnit,
  SectionUnit,
  SentenceUnit,
  WordUnit,
} from "../shared/types";

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "CANVAS",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "NAV",
  "FOOTER",
  "HEADER",
  "ASIDE",
  "FORM",
  "BUTTON",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "LABEL",
]);

const BLOCK_TAGS = new Set([
  "P",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "TD",
  "TH",
  "FIGCAPTION",
  "DD",
  "DT",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "ARTICLE",
  "SECTION",
]);

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function likelyChrome(el: Element): boolean {
  const role = el.getAttribute("role") || "";
  const cls = `${el.className || ""} ${el.id || ""}`.toLowerCase();
  if (["navigation", "banner", "contentinfo", "complementary", "search"].includes(role)) {
    return true;
  }
  return /(nav|menu|sidebar|footer|header|cookie|consent|promo|ad-|advert|share|social|breadcrumb)/.test(
    cls,
  );
}

function findRoot(skipChrome: boolean): Element {
  const candidates = [
    document.querySelector("article"),
    document.querySelector('[role="main"]'),
    document.querySelector("main"),
    document.querySelector("#content"),
    document.querySelector(".post-content, .entry-content, .article-body, .story-body"),
    document.body,
  ].filter(Boolean) as Element[];

  for (const c of candidates) {
    if (!skipChrome || !likelyChrome(c)) return c;
  }
  return document.body;
}

function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g);
  return (parts || [cleaned]).map((s) => s.trim()).filter(Boolean);
}

function tokenizeWords(sentence: string): WordUnit[] {
  const words: WordUnit[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    words.push({
      id: uid("w"),
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return words;
}

function wrapBlock(el: Element, paragraphId: string): ParagraphUnit | null {
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (text.length < 2) return null;

  el.setAttribute("data-listen-p", paragraphId);
  const sentences: SentenceUnit[] = [];
  const rawSentences = splitSentences(text);

  // Prefer wrapping text nodes so highlighting can target spans
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  // Build sentence model from plain text; highlight maps by sentence index via spans
  for (const s of rawSentences) {
    const sid = uid("s");
    sentences.push({
      id: sid,
      text: s,
      words: tokenizeWords(s),
      elementId: sid,
    });
  }

  // Inject sentence spans into the element when structure is simple
  if (textNodes.length === 1 && rawSentences.length > 0) {
    const node = textNodes[0];
    const full = node.textContent || "";
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const sentence of sentences) {
      const idx = full.indexOf(sentence.text, cursor);
      if (idx === -1) continue;
      if (idx > cursor) {
        frag.appendChild(document.createTextNode(full.slice(cursor, idx)));
      }
      const span = document.createElement("span");
      span.className = "listen-sentence";
      span.dataset.listenSentence = sentence.id;
      // word spans
      let local = 0;
      for (const w of sentence.words) {
        if (w.start > local) {
          span.appendChild(document.createTextNode(sentence.text.slice(local, w.start)));
        }
        const wspan = document.createElement("span");
        wspan.className = "listen-word";
        wspan.dataset.listenWord = w.id;
        wspan.textContent = w.text;
        span.appendChild(wspan);
        local = w.end;
      }
      if (local < sentence.text.length) {
        span.appendChild(document.createTextNode(sentence.text.slice(local)));
      }
      frag.appendChild(span);
      cursor = idx + sentence.text.length;
    }
    if (cursor < full.length) {
      frag.appendChild(document.createTextNode(full.slice(cursor)));
    }
    node.parentNode?.replaceChild(frag, node);
  } else {
    // Fallback: mark whole block; sentence highlighting uses overlay class on paragraph
    for (const sentence of sentences) {
      /* ids already assigned */
    }
  }

  return {
    id: paragraphId,
    text,
    sentences,
    elementId: paragraphId,
  };
}

export function extractDocument(opts: { skipChrome?: boolean } = {}): DocumentModel {
  clearListenMarks(document.body);
  const root = findRoot(opts.skipChrome !== false);
  const sections: SectionUnit[] = [];
  let current: SectionUnit = {
    id: uid("sec"),
    title: document.title || "Introduction",
    level: 1,
    paragraphs: [],
    startIndex: 0,
    endIndex: 0,
  };
  sections.push(current);

  const blocks: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (opts.skipChrome !== false && likelyChrome(el) && el !== root) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!isVisible(el)) return NodeFilter.FILTER_REJECT;
      if (BLOCK_TAGS.has(el.tagName) || el.tagName === "DIV") {
        // Prefer leaf-ish text blocks
        const hasBlockChild = Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName));
        if (!hasBlockChild && (el.textContent || "").trim().length > 0) {
          return NodeFilter.FILTER_ACCEPT;
        }
      }
      return NodeFilter.FILTER_SKIP;
    },
  });

  while (walker.nextNode()) {
    blocks.push(walker.currentNode as Element);
  }

  // If walker found nothing useful, fall back to paragraphs
  if (blocks.length === 0) {
    root.querySelectorAll("p, h1, h2, h3, h4, li").forEach((el) => blocks.push(el));
  }

  for (const el of blocks) {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const title = (el.textContent || "").trim() || `Section ${sections.length + 1}`;
      if (current.paragraphs.length === 0 && sections.length === 1 && current.title === document.title) {
        current.title = title;
        current.level = level;
        el.setAttribute("data-listen-section", current.id);
        continue;
      }
      current = {
        id: uid("sec"),
        title,
        level,
        paragraphs: [],
        startIndex: 0,
        endIndex: 0,
      };
      el.setAttribute("data-listen-section", current.id);
      sections.push(current);
      continue;
    }

    const pid = uid("p");
    const para = wrapBlock(el, pid);
    if (para) current.paragraphs.push(para);
  }

  // Drop empty sections
  const nonempty = sections.filter((s) => s.paragraphs.length > 0);
  const finalSections = nonempty.length ? nonempty : sections;

  const flatParagraphs: ParagraphUnit[] = [];
  const flatSentences: SentenceUnit[] = [];
  let sentenceCursor = 0;
  for (const sec of finalSections) {
    sec.startIndex = sentenceCursor;
    for (const p of sec.paragraphs) {
      flatParagraphs.push(p);
      for (const s of p.sentences) {
        flatSentences.push(s);
        sentenceCursor += 1;
      }
    }
    sec.endIndex = Math.max(sec.startIndex, sentenceCursor - 1);
  }

  return {
    title: document.title,
    url: location.href,
    sections: finalSections,
    flatSentences,
    flatParagraphs,
  };
}

export function extractSelection(): DocumentModel | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;
  const text = sel.toString().replace(/\s+/g, " ").trim();
  const sentences = splitSentences(text).map((s) => {
    const id = uid("s");
    return { id, text: s, words: tokenizeWords(s), elementId: id } satisfies SentenceUnit;
  });
  const paragraph: ParagraphUnit = {
    id: uid("p"),
    text,
    sentences,
    elementId: "selection",
  };
  const section: SectionUnit = {
    id: uid("sec"),
    title: "Selection",
    level: 1,
    paragraphs: [paragraph],
    startIndex: 0,
    endIndex: Math.max(0, sentences.length - 1),
  };
  return {
    title: `Selection — ${document.title}`,
    url: location.href,
    sections: [section],
    flatSentences: sentences,
    flatParagraphs: [paragraph],
  };
}

export function clearListenMarks(root: ParentNode = document) {
  root.querySelectorAll(".listen-sentence, .listen-word").forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  });
  root.querySelectorAll("[data-listen-p], [data-listen-section]").forEach((el) => {
    el.removeAttribute("data-listen-p");
    el.removeAttribute("data-listen-section");
    el.classList.remove("listen-active-paragraph", "listen-active-sentence");
  });
}

export function highlightSentence(sentenceId: string | null, wordId: string | null = null) {
  document.querySelectorAll(".listen-sentence.listen-active").forEach((el) => {
    el.classList.remove("listen-active");
  });
  document.querySelectorAll(".listen-word.listen-active").forEach((el) => {
    el.classList.remove("listen-active");
  });
  document.querySelectorAll(".listen-active-paragraph").forEach((el) => {
    el.classList.remove("listen-active-paragraph");
  });

  if (!sentenceId) return;

  const sentenceEl = document.querySelector(`[data-listen-sentence="${sentenceId}"]`);
  if (sentenceEl) {
    sentenceEl.classList.add("listen-active");
    const para = sentenceEl.closest("[data-listen-p]");
    para?.classList.add("listen-active-paragraph");
    if (wordId) {
      sentenceEl.querySelector(`[data-listen-word="${wordId}"]`)?.classList.add("listen-active");
    }
    sentenceEl.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  // Fallback: highlight paragraph containing matching text via data-listen-p walking
  // (selection mode has no DOM anchors)
}
