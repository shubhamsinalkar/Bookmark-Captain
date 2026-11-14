/**
 * Whether a build talks to this machine (`pnpm dev`, the e2e suite) rather than the deployed
 * API. Such builds get their own name, an orange icon and a "Local" badge in the popup, so
 * they can't be mistaken for the released extension when both are loaded in one Chrome.
 */
export function isLocalApi(apiUrl: string): boolean {
  const { hostname } = new URL(apiUrl);
  return (
    ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.test')
  );
}
