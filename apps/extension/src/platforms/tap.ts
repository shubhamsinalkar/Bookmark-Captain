/**
 * Network tap: the part of a platform connector that runs in the page's own JavaScript
 * world. It wraps `fetch` and `XMLHttpRequest` and forwards selected JSON responses (the
 * data the page already loads for itself) to the extension's isolated content script.
 *
 * Reading the site's own API responses holds up much better than scraping its HTML, which
 * changes with every redesign. Nothing here sends data anywhere; the isolated script decides
 * what, if anything, leaves the browser.
 *
 * Keep this file dependency-free: it is bundled into a tiny script injected at document_start.
 */

/** Marks window messages from the tap, so the isolated script can pick them out. */
export const TAP_MESSAGE_KEY = '__bookmarkCaptainTap';
/** Marks window messages from the isolated script that switch a gated tap on or off. */
export const TAP_CONTROL_KEY = '__bookmarkCaptainTapControl';

export interface TapMessage {
  [TAP_MESSAGE_KEY]: string;
  /** Operation name chosen by the connector, e.g. the GraphQL operation "Bookmarks". */
  op: string;
  status: number;
  /** The request body as text, for string and form bodies (mutations carry their variables here). */
  requestBody?: string;
  json: unknown;
}

const MAX_REQUEST_BODY = 10_000;
const MAX_JSON_CHARS = 5_000_000;
/** Responses held back while a gated tap waits to hear whether it is wanted. */
const MAX_BUFFERED = 60;
const NOT_JSON = /html|image|javascript|css|font|video|audio|octet-stream|protobuf|xml/i;

/** Some sites prefix JSON with `for (;;);` or `)]}'` to stop it being run as a script. */
function parseJson(text: string): unknown {
  return JSON.parse(text.replace(/^\s*(?:for\s*\(;;\);|while\s*\(1\);|\)\]\}',?)/, ''));
}

/** A request body as text: JSON strings as they are, forms (e.g. `id=t3_abc`) encoded. */
function bodyText(body: unknown): string | undefined {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    const fields = new URLSearchParams();
    for (const [key, value] of body) if (typeof value === 'string') fields.append(key, value);
    return fields.toString();
  }
  return undefined;
}

export interface TapOptions {
  /**
   * Gated taps buffer responses until the isolated script says whether they are wanted
   * (it first has to ask the background). Used on sites the user taught the extension,
   * where only the saved page matters; X's tap is always on.
   */
  gated?: boolean;
}

/** Main world: forwards responses whose URL `operationOf` recognises. */
export function installNetworkTap(
  tag: string,
  operationOf: (url: string) => string | null,
  { gated = false }: TapOptions = {},
) {
  let mode: 'buffer' | 'on' | 'off' = gated ? 'buffer' : 'on';
  const buffer: TapMessage[] = [];
  const deliver = (message: TapMessage) => window.postMessage(message, window.location.origin);

  const emit = (op: string, status: number, requestBody: unknown, json: unknown) => {
    const body = bodyText(requestBody);
    const message: TapMessage = {
      [TAP_MESSAGE_KEY]: tag,
      op,
      status,
      json,
      ...(body !== undefined && body.length <= MAX_REQUEST_BODY && { requestBody: body }),
    };
    if (mode === 'on') deliver(message);
    else if (mode === 'buffer' && buffer.length < MAX_BUFFERED) buffer.push(message);
  };
  /**
   * A request with a body (a mutation) whose answer isn't labelled JSON: some sites label
   * their JSON otherwise (Instagram's GraphQL: text/html). Passed on with the answer if it
   * is JSON after all, and without it (null) if not: the request still says what happened.
   */
  const emitUnlabelled = (op: string, status: number, requestBody: unknown, text: string) => {
    if (bodyText(requestBody) === undefined) return;
    let json: unknown = null;
    try {
      if (text.length <= MAX_JSON_CHARS) json = parseJson(text);
    } catch {
      // Not JSON: the request alone.
    }
    emit(op, status, requestBody, json);
  };
  const emitText = (op: string, status: number, requestBody: unknown, text: string) => {
    if (text.length > MAX_JSON_CHARS) return;
    // A mutation may answer with an empty body: its request is what matters.
    if (text.trim() === '') {
      if (bodyText(requestBody) !== undefined) emit(op, status, requestBody, null);
      return;
    }
    try {
      emit(op, status, requestBody, parseJson(text));
    } catch {
      // Not JSON: ignore.
    }
  };

  if (gated) {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (data?.[TAP_CONTROL_KEY] !== tag) return;
      if (data.enabled === true) {
        mode = 'on';
        for (const message of buffer.splice(0)) deliver(message);
      } else {
        mode = 'off';
        buffer.length = 0;
      }
    });
  }

  // The native functions are always invoked with an explicit receiver (.apply/.call) below.
  /* eslint-disable @typescript-eslint/unbound-method */
  const nativeFetch = window.fetch;
  const proto = XMLHttpRequest.prototype;
  const nativeOpen = proto.open;
  const nativeSend = proto.send;
  /* eslint-enable @typescript-eslint/unbound-method */

  window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
    let op: string | null = null;
    let requestBody: Promise<unknown> = Promise.resolve(undefined);
    let hasBody = false;
    try {
      const [input, init] = args;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      op = mode === 'off' ? null : operationOf(url);
      if (op && init?.body !== undefined && init.body !== null) {
        requestBody = Promise.resolve(init.body);
        hasBody = true;
      } else if (
        op &&
        input instanceof Request &&
        input.method !== 'GET' &&
        input.method !== 'HEAD'
      ) {
        // Some sites (YouTube) pass a Request with the body inside it: read a copy before
        // the native fetch consumes it.
        requestBody = input
          .clone()
          .text()
          .catch(() => undefined);
        hasBody = true;
      }
    } catch {
      // Never break the page.
    }

    const response = await nativeFetch.apply(window, args);
    if (!op || mode === 'off') return response;
    try {
      const operation = op;
      const labelledJson = !NOT_JSON.test(response.headers.get('content-type') ?? '');
      if (labelledJson || hasBody) {
        void Promise.all([response.clone().text(), requestBody])
          .then(([text, body]) =>
            labelledJson
              ? emitText(operation, response.status, body, text)
              : emitUnlabelled(operation, response.status, body, text),
          )
          .catch(() => undefined);
      }
    } catch {
      // Never break the page.
    }
    return response;
  };

  const urls = new WeakMap<XMLHttpRequest, string>();

  proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    urls.set(this, String(args[1]));
    return (nativeOpen as (...a: unknown[]) => void).apply(this, args);
  };

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const url = urls.get(this);
    const op = mode !== 'off' && url ? operationOf(url) : null;
    if (op) {
      this.addEventListener('load', () => {
        try {
          if (NOT_JSON.test(this.getResponseHeader('content-type') ?? '')) {
            const text =
              this.responseType === '' || this.responseType === 'text' ? this.responseText : '';
            emitUnlabelled(op, this.status, body, text);
            return;
          }
          if (this.responseType === 'json') emit(op, this.status, body, this.response);
          else if (this.responseType === '' || this.responseType === 'text') {
            emitText(op, this.status, body, this.responseText);
          }
        } catch {
          // Never break the page.
        }
      });
    }
    return nativeSend.call(this, body);
  };
}

/** Isolated world: receives what the tap for `tag` forwards. */
export function listenToTap(tag: string, handler: (message: TapMessage) => void) {
  window.addEventListener('message', (event: MessageEvent) => {
    // Only this page's own window; never other frames or origins.
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data as Partial<TapMessage> | null;
    if (typeof data !== 'object' || data === null) return;
    if (data[TAP_MESSAGE_KEY] !== tag || typeof data.op !== 'string') return;
    if (typeof data.status !== 'number') return;
    handler(data as TapMessage);
  });
}

/** Isolated world: switches a gated tap on (flushing what it buffered) or off. */
export function controlTap(tag: string, enabled: boolean) {
  window.postMessage({ [TAP_CONTROL_KEY]: tag, enabled }, window.location.origin);
}
