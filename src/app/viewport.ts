// Full-screen sizing for iPhone, in the browser and as a Home Screen app.
// The page's CSS decides how big the 3D view is (see the notes on the Home Screen app in
// style.css); this file reads the size the view really got and reports it. Sizes on iOS can
// be wrong at launch and settle later without a resize event, so we watch the box itself.

export interface ViewSize {
  width: number;
  height: number;
}

type Listener = (size: ViewSize) => void;

const stage = () => document.getElementById('stage') as HTMLDivElement;

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function measure(): ViewSize {
  const box = stage().getBoundingClientRect();
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

export function watchViewport(listener: Listener): () => void {
  // the stylesheet keys off this too, in case the display-mode query is not honored
  document.documentElement.classList.toggle('standalone', isStandalone());
  let last: ViewSize = { width: 0, height: 0 };
  const apply = () => {
    const size = measure();
    if (size.width < 2 || size.height < 2) return;
    if (size.width === last.width && size.height === last.height) return;
    last = size;
    listener(size);
  };
  apply();
  const observer = new ResizeObserver(apply);
  observer.observe(stage());
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  window.visualViewport?.addEventListener('resize', apply);
  document.addEventListener('visibilitychange', apply);
  const timers = [50, 250, 600, 1500, 3000].map((ms) => window.setTimeout(apply, ms));
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
    window.visualViewport?.removeEventListener('resize', apply);
    document.removeEventListener('visibilitychange', apply);
    timers.forEach((t) => window.clearTimeout(t));
  };
}

/** Smoothed frame rate, for the readouts. */
let fps = 0;
// the last ten seconds or so of frame times, to count late frames
const recent = new Float32Array(600);
let recentAt = 0;
let recentCount = 0;
/** Call once per frame. */
export function tickFps(dtSeconds: number) {
  if (dtSeconds <= 0) return;
  const now = 1 / dtSeconds;
  fps = fps === 0 ? now : fps + (now - fps) * 0.05;
  if (dtSeconds < 0.25) {
    recent[recentAt] = dtSeconds * 1000;
    recentAt = (recentAt + 1) % recent.length;
    recentCount = Math.min(recent.length, recentCount + 1);
  }
}

export function currentFps(): number {
  return fps;
}

/** How many of the recent frames ran late on a 60-a-second screen, and the longest one. */
export function lateFrames(): string {
  if (recentCount === 0) return 'late frames 0%';
  let late = 0;
  let worst = 0;
  for (let i = 0; i < recentCount; i++) {
    if (recent[i] > 22) late++;
    worst = Math.max(worst, recent[i]);
  }
  return `late frames ${Math.round((100 * late) / recentCount)}% · longest ${worst.toFixed(0)} ms`;
}

function insets(): { top: string; bottom: string } {
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string) => (cs.getPropertyValue(name).trim() || '0px').replace('px', '');
  return { top: read('--sat'), bottom: read('--sab') };
}

/** One line that tells us, from a screenshot, whether the picture fills the phone's screen. */
export function fitLine(): string {
  const s = measure();
  const i = insets();
  return `view ${s.width}x${s.height} · window ${window.innerWidth}x${window.innerHeight} · screen ${screen.width}x${screen.height} · top ${i.top} · bottom ${i.bottom}`;
}

/** The longer readout for the concept viewer's fit check. */
export function viewportReport(): string {
  const s = measure();
  const i = insets();
  return [
    `mode ${isStandalone() ? 'home screen' : 'browser'}`,
    `view ${s.width} x ${s.height}`,
    `window ${window.innerWidth} x ${window.innerHeight}`,
    `screen ${screen.width} x ${screen.height}`,
    `dpr ${window.devicePixelRatio}`,
    `safe top ${i.top} bottom ${i.bottom}`,
    `fps ${fps.toFixed(0)}`,
  ].join('\n');
}
