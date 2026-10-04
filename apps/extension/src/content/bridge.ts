import {
  EXTENSION_MESSAGE_SOURCE,
  type ExtensionBridgeMessage,
  type PlatformAction,
} from '@bc/shared/constants';
import type { Platform } from '@bc/shared';
import { VERSION } from '../config';
import { type RuntimeRequest, sendToBackground } from '../messages';

/**
 * Runs on the web app's /extension/connect and /settings pages. Relays window messages from
 * the page to the background worker, so the page can hand over an API token and manage
 * platform connections without knowing the extension's id. (The background additionally
 * only accepts a token from the connect page.)
 */

type BridgeReply = ExtensionBridgeMessage extends infer M
  ? M extends { source: string }
    ? Omit<M, 'source'>
    : never
  : never;

function reply(message: BridgeReply) {
  window.postMessage({ source: EXTENSION_MESSAGE_SOURCE, ...message }, window.location.origin);
}

function platformRequest(platform: Platform, action: PlatformAction): RuntimeRequest {
  switch (action) {
    case 'connect':
      return { type: 'platform:connect', platform };
    case 'disconnect':
      return { type: 'platform:disconnect', platform };
    case 'sync':
      return { type: 'platform:sync', platform, mode: 'catch-up' };
    case 'import-all':
      return { type: 'platform:sync', platform, mode: 'full' };
  }
}

const ACTIONS = new Set<string>(['connect', 'disconnect', 'sync', 'import-all']);

window.addEventListener('message', (event: MessageEvent) => {
  // Only this page's own scripts, never other frames or origins.
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as Partial<ExtensionBridgeMessage> | null;
  if (data?.source !== EXTENSION_MESSAGE_SOURCE) return;

  if (data.type === 'ping') {
    void sendToBackground({ type: 'getStatus' }).then((status) => {
      reply({ type: 'pong', version: VERSION, connected: status.connected });
    });
  } else if (data.type === 'connect' && typeof data.token === 'string') {
    void sendToBackground({ type: 'connect', token: data.token }).then((result) => {
      reply(result.ok ? { type: 'connected' } : { type: 'connect-failed', error: result.error });
    });
  } else if (data.type === 'platforms-request') {
    void sendToBackground({ type: 'getStatus' }).then((status) => {
      reply({ type: 'platforms', platforms: status.platforms });
    });
  } else if (
    data.type === 'platform-action' &&
    typeof data.platform === 'string' &&
    typeof data.action === 'string' &&
    ACTIONS.has(data.action)
  ) {
    void chrome.runtime
      .sendMessage(platformRequest(data.platform, data.action))
      .then((result: { ok: boolean; error?: string }) => {
        reply({ type: 'platform-action-result', ok: result.ok, error: result.error });
      });
  }
});
