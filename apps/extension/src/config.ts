// Replaced at build time by esbuild `define` (see scripts/build.ts).
declare const __API_URL__: string;
declare const __WEB_URL__: string;
declare const __VERSION__: string;

export const API_URL = __API_URL__;
export const WEB_URL = __WEB_URL__;
export const VERSION = __VERSION__;

/** The web page that hands the extension its API token. */
export const CONNECT_PAGE_URL = new URL('/extension/connect', WEB_URL).toString();
