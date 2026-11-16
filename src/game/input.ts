// Swipes and keys. A swipe fires as soon as the finger has moved far enough,
// without waiting for it to lift, so moves feel immediate.
// One touch makes one move: however long the swipe, the runner changes one lane.

export type Move = 'left' | 'right' | 'up' | 'down';

const THRESHOLD = 22; // points

export function listenForMoves(surface: HTMLElement, onMove: (move: Move) => void): () => void {
  let start: { x: number; y: number; id: number } | null = null;

  const down = (e: PointerEvent) => {
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const move = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
    if (Math.abs(dx) > Math.abs(dy)) onMove(dx > 0 ? 'right' : 'left');
    else onMove(dy > 0 ? 'down' : 'up');
    // this touch has made its move; the next one starts with a fresh touch
    start = null;
  };
  const up = (e: PointerEvent) => {
    if (start && e.pointerId === start.id) start = null;
  };
  const key = (e: KeyboardEvent) => {
    const map: Record<string, Move> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
      a: 'left',
      d: 'right',
      w: 'up',
      s: 'down',
      ' ': 'up',
    };
    const m = map[e.key];
    if (m) {
      e.preventDefault();
      onMove(m);
    }
  };

  surface.addEventListener('pointerdown', down);
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerup', up);
  surface.addEventListener('pointercancel', up);
  window.addEventListener('keydown', key);
  return () => {
    surface.removeEventListener('pointerdown', down);
    surface.removeEventListener('pointermove', move);
    surface.removeEventListener('pointerup', up);
    surface.removeEventListener('pointercancel', up);
    window.removeEventListener('keydown', key);
  };
}
