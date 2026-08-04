/**
 * Fetch helper that goes through the service worker when we're in a content
 * script. Chrome treats content-script fetch as coming from the page origin,
 * so https:// pages to http://127.0.0.1 hit Private Network Access and die
 * with "Failed to fetch". The background worker has host_permissions and
 * bypasses that.
 */

export type ProxyFetchRequest = {
  type: "PROXY_FETCH";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** UTF-8 request body (JSON string, etc.). */
  body?: string;
};

export type ProxyFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Response body as base64 (empty string when none). */
  bodyBase64: string;
  error?: string;
};

function inContentScript(): boolean {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return false;
    // Popup / options / SW are chrome-extension://; content scripts share the page URL.
    return typeof location !== "undefined" && location.protocol !== "chrome-extension:";
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array();
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function proxyFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.headers) {
    const h = new Headers(init.headers);
    h.forEach((value, key) => {
      headers[key] = value;
    });
  }
  let body: string | undefined;
  if (typeof init.body === "string") body = init.body;
  else if (init.body != null) {
    throw new Error("proxyFetch only supports string bodies");
  }

  const payload: ProxyFetchRequest = {
    type: "PROXY_FETCH",
    url,
    method: init.method || "GET",
    headers,
    body,
  };

  const res = (await chrome.runtime.sendMessage(payload)) as ProxyFetchResponse | undefined;
  if (!res) throw new Error("No response from TalkToMe background");
  if (res.error && !res.status) throw new Error(res.error);

  const bytes = base64ToBytes(res.bodyBase64 || "");
  // Copy into a fresh ArrayBuffer so Response gets a plain ArrayBuffer, not ArrayBufferLike.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Response(ab, {
    status: res.status || 0,
    statusText: res.statusText || "",
    headers: res.headers,
  });
}

/** Page-safe fetch: backgrounds through the service worker from content scripts. */
export async function extensionFetch(url: string, init?: RequestInit): Promise<Response> {
  if (inContentScript()) return proxyFetch(url, init);
  return fetch(url, init);
}

/** Used by the service worker to fulfil PROXY_FETCH. */
export async function performProxyFetch(req: ProxyFetchRequest): Promise<ProxyFetchResponse> {
  try {
    const res = await fetch(req.url, {
      method: req.method || "GET",
      headers: req.headers,
      body: req.body,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers,
      bodyBase64: bytesToBase64(buf),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      statusText: "",
      headers: {},
      bodyBase64: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
