// Build number and self-update.
// The Home Screen app must never sit on a stale build, so we check version.json
// (never cached) at launch and whenever the app comes back to the foreground.

declare const __BUILD__: string;
export const BUILD: string = __BUILD__;

let canReload: () => boolean = () => true;

/** Screens that must not be interrupted (a run in progress) can veto an auto-reload. */
export function setReloadGuard(fn: () => boolean) {
  canReload = fn;
}

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { build?: string };
    return data.build ?? null;
  } catch {
    return null; // offline: keep playing what we have
  }
}

async function checkForUpdate() {
  const latest = await latestBuild();
  if (!latest || latest === BUILD) return;
  if (!canReload()) return;
  // One attempt per target build, so a slow deploy can't cause a reload loop.
  const key = 'rr-update-tried';
  if (sessionStorage.getItem(key) === latest) return;
  sessionStorage.setItem(key, latest);
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    /* ignore */
  }
  // A fresh URL sidesteps any cached copy of the page.
  const url = new URL(location.href);
  url.searchParams.set('b', latest);
  location.replace(url.toString());
}

export function startUpdates() {
  if (import.meta.env.DEV) return;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  void checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
}
