/**
 * Runtime constants with no dependencies (no zod), so size-sensitive bundles such as the
 * browser extension can import them via `@bc/shared/constants` without pulling in schemas.
 */
import type { Platform } from './platforms';

export * from './platforms';

/** Most items accepted by one ingest or remove request. */
export const MAX_INGEST_BATCH = 500;

/** Prefix that makes API tokens recognisable (e.g. by secret scanners). */
export const API_TOKEN_PREFIX = 'bct_';

/** Name of the httpOnly session cookie set by the API. */
export const SESSION_COOKIE_NAME = 'bc_session';

/** window.postMessage protocol between the web app and the extension's content script. */
export const EXTENSION_MESSAGE_SOURCE = 'bookmark-captain';

/** A platform the extension syncs by reading the user's own signed-in pages (e.g. X). */
export interface PlatformSyncStatus {
  platform: Platform;
  label: string;
  enabled: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Posts the extension has sent from this platform (capped, so "at least"). */
  itemsSynced: number;
  /** The site it reads, e.g. "https://www.pinterest.com". */
  origin: string;
  /** Taught with "Sync this list" rather than built in. */
  learned: boolean;
}

/** User actions on a platform connection. */
export type PlatformAction = 'connect' | 'sync' | 'import-all' | 'disconnect';

type Bridge<T> = { source: typeof EXTENSION_MESSAGE_SOURCE } & T;

export type ExtensionBridgeMessage =
  | Bridge<{ type: 'ping' }>
  | Bridge<{ type: 'pong'; version: string; connected: boolean }>
  | Bridge<{ type: 'connect'; token: string }>
  | Bridge<{ type: 'connected' }>
  | Bridge<{ type: 'connect-failed'; error: string }>
  | Bridge<{ type: 'platforms-request' }>
  | Bridge<{ type: 'platforms'; platforms: PlatformSyncStatus[] }>
  | Bridge<{ type: 'platform-action'; platform: Platform; action: PlatformAction }>
  | Bridge<{ type: 'platform-action-result'; ok: boolean; error?: string }>;
