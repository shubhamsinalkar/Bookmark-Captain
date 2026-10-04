import { EXTENSION_MESSAGE_SOURCE, type ExtensionBridgeMessage } from '@bc/shared';

/**
 * Talks to the Chrome extension through its content script on this page (window messages),
 * so the page never needs to know the extension's id. The content script only runs on
 * /extension/connect and /settings.
 */

type BridgeMessage = ExtensionBridgeMessage;
type BridgeType = BridgeMessage['type'];
/** Omit that distributes over a union (plain Omit collapses it to the shared keys). */
type WithoutSource<T> = T extends unknown ? Omit<T, 'source'> : never;
type Outgoing = WithoutSource<
  Extract<BridgeMessage, { type: 'ping' | 'connect' | 'platforms-request' | 'platform-action' }>
>;

export function postToExtension(message: Outgoing) {
  // Target our own origin: only the extension's content script on this page can read it.
  window.postMessage({ source: EXTENSION_MESSAGE_SOURCE, ...message }, window.location.origin);
}

function isBridgeMessage(event: MessageEvent): event is MessageEvent<BridgeMessage> {
  const data: unknown = event.data;
  return (
    event.source === window &&
    event.origin === window.location.origin &&
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === EXTENSION_MESSAGE_SOURCE
  );
}

/** Waits for the first bridge message of one of the given types, or null on timeout. */
export function waitForExtension<T extends BridgeType>(
  types: T[],
  timeoutMs: number,
): Promise<Extract<BridgeMessage, { type: T }> | null> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (!isBridgeMessage(event) || !(types as string[]).includes(event.data.type)) return;
      cleanup();
      resolve(event.data as Extract<BridgeMessage, { type: T }>);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    window.addEventListener('message', onMessage);
  });
}

/** Sends a request and waits for the reply of the given type. */
export function askExtension<T extends BridgeType>(
  message: Outgoing,
  replyType: T,
  timeoutMs: number,
): Promise<Extract<BridgeMessage, { type: T }> | null> {
  const reply = waitForExtension([replyType], timeoutMs);
  postToExtension(message);
  return reply;
}
