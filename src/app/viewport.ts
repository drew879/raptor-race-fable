// Full-screen sizing for iPhone, in the browser and as a Home Screen app.
// Lessons this handles: a strip left uncovered at the bottom of the Home Screen app,
// and sizes that are wrong at launch and never fire a resize event.

export interface ViewSize {
  width: number;
  height: number;
}

type Listener = (size: ViewSize) => void;

const stage = () => document.getElementById('stage') as HTMLDivElement;
const ui = () => document.getElementById('ui') as HTMLDivElement;

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function measure(): ViewSize {
  const width = Math.max(window.innerWidth, document.documentElement.clientWidth);
  let height = Math.max(window.innerHeight, document.documentElement.clientHeight);
  // A Home Screen app owns the whole screen. If the web view reports a little less
  // than the screen in portrait, trust the screen so nothing is left uncovered.
  if (isStandalone() && window.innerHeight > window.innerWidth) {
    const gap = screen.height - height;
    if (gap > 0 && gap < 140) height = screen.height;
  }
  return { width, height };
}

export function watchViewport(listener: Listener): () => void {
  let last: ViewSize = { width: 0, height: 0 };
  const apply = () => {
    const size = measure();
    if (size.width === last.width && size.height === last.height) return;
    last = size;
    for (const el of [stage(), ui()]) {
      el.style.width = `${size.width}px`;
      el.style.height = `${size.height}px`;
    }
    listener(size);
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  window.visualViewport?.addEventListener('resize', apply);
  document.addEventListener('visibilitychange', apply);
  // iOS sometimes settles its sizes a beat after launch without telling anyone.
  const timers = [50, 250, 600, 1500].map((ms) => window.setTimeout(apply, ms));
  return () => {
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
    window.visualViewport?.removeEventListener('resize', apply);
    document.removeEventListener('visibilitychange', apply);
    timers.forEach((t) => window.clearTimeout(t));
  };
}

/** Numbers for the on-screen fit check, so a screenshot from the phone tells us everything. */
let fps = 0;
/** Call once per frame; the fit check shows the smoothed frame rate. */
export function tickFps(dtSeconds: number) {
  if (dtSeconds <= 0) return;
  const now = 1 / dtSeconds;
  fps = fps === 0 ? now : fps + (now - fps) * 0.05;
}

export function currentFps(): number {
  return fps;
}

export function viewportReport(): string {
  const cs = getComputedStyle(document.documentElement);
  const inset = (name: string) => cs.getPropertyValue(name).trim() || '0px';
  const s = measure();
  return [
    `mode ${isStandalone() ? 'home screen' : 'browser'}`,
    `view ${s.width} x ${s.height}`,
    `inner ${window.innerWidth} x ${window.innerHeight}`,
    `screen ${screen.width} x ${screen.height}`,
    `dpr ${window.devicePixelRatio}`,
    `safe top ${inset('--sat')} bottom ${inset('--sab')}`,
    `fps ${fps.toFixed(0)}`,
  ].join('\n');
}
