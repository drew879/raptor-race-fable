// Music and sound, played by the browser as the game runs: nothing is recorded.
//
// A FIRST SKETCH, written without being able to hear it. The timing, the notes and the levels
// are checked by measurement; whether it sounds right is for Drew's ears.
//
// His direction: eerie and mysterious, with the pace of a chase (about 120 beats a minute);
// brooding bass synths with echo and reverb; ominous strings; and collecting amber should be
// part of the music and land on the beat. From the brief: a minor key, building as you close
// in on the egg.
//
// How it works. Time is a grid of sixteenth notes, 125 ms apart. A scheduler walks the grid a
// little ahead of the clock and asks each layer what it plays on each step. How many layers
// are playing depends on how close the runner is to the egg. Picking up amber plays a note on
// the next step of the grid, chosen from the chord of the bar it lands in, climbing as a line
// of amber is collected: at running speed a line of amber is exactly a run of eighth notes.

const BPM = 120;
const STEP = 60 / BPM / 4; // a sixteenth note, in seconds
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Eight bars in D minor, two seconds each. Each: the bass note, the strings' three notes, and the ladder amber climbs. */
const BARS = (() => {
  const Dm = { bass: 38, pad: [50, 57, 65], amber: [74, 77, 81, 86, 89] };
  const Bb = { bass: 34, pad: [50, 58, 65], amber: [74, 77, 82, 86, 89] };
  const Gm = { bass: 43, pad: [50, 58, 67], amber: [74, 79, 82, 86, 91] };
  const Eb = { bass: 39, pad: [51, 58, 67], amber: [75, 79, 82, 87, 91] }; // the flattened second: the eerie one
  const A = { bass: 45, pad: [49, 57, 64], amber: [73, 76, 81, 85, 88] }; // and the pull back home
  return [Dm, Dm, Bb, Gm, Dm, Dm, Eb, A];
})();
/** A high, slow line over the top: [bar, step in the bar, note, length in steps]. The half-step from B flat to A is what makes it uneasy. */
const MOTIF: [number, number, number, number][] = [[0, 0, 81, 10], [0, 12, 82, 4], [1, 0, 81, 8], [1, 8, 77, 8], [4, 0, 86, 10], [4, 12, 84, 4], [5, 0, 82, 8], [5, 8, 81, 8]];
/** The driving rhythm, in sixteenths of a bar: three, three, two. */
const PULSE = [0, 6, 12];

type Mode = 'quiet' | 'chase' | 'dash' | 'won' | 'lost';

export class Sound {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private reverb!: GainNode;
  private echo!: GainNode;
  private noise!: AudioBuffer;
  private timer = 0;
  private t0 = 0;
  private next = 0; // the next step of the grid to be scheduled
  private mode: Mode = 'quiet';
  /** 0 far behind the egg, 1 right on it: how much of the band is playing. */
  private close = 0;
  private muted = false;
  private amberStep = -1;
  private amberRung = 0;
  private amberAt = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem('rr-sound1') === '0';
    } catch {
      /* private mode */
    }
    // Browsers only let sound start from a tap, and on an iPhone only from the end of one.
    const unlock = () => this.unlock();
    for (const type of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(type, unlock, { passive: true });
  }

  get on() {
    return !this.muted;
  }

  setOn(on: boolean) {
    this.muted = !on;
    try {
      localStorage.setItem('rr-sound1', on ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (this.ctx) this.out.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }

  /** Start (or wake) the sound. Safe to call again and again. */
  private unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.build(this.ctx);
      // An iPhone with its ring switch off silences this kind of sound unless ordinary audio
      // is also playing. So: a short silent recording, looping, as ordinary audio.
      const bytes = new Uint8Array(44 + 800);
      const view = new DataView(bytes.buffer);
      const put = (at: number, text: string) => [...text].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
      put(0, 'RIFF');
      view.setUint32(4, 36 + 800, true);
      put(8, 'WAVEfmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true);
      view.setUint32(28, 8000, true);
      view.setUint16(32, 1, true);
      view.setUint16(34, 8, true);
      put(36, 'data');
      view.setUint32(40, 800, true);
      bytes.fill(128, 44);
      const quiet = new Audio(`data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`);
      quiet.loop = true;
      quiet.setAttribute('playsinline', '');
      void quiet.play().catch(() => undefined);
      this.t0 = this.ctx.currentTime + 0.1;
      this.next = 0;
      this.timer = window.setInterval(() => this.schedule(), 30);
    }
    if (this.ctx.state === 'suspended' && !this.held) void this.ctx.resume();
  }

  private held = false;
  /** Stop the clock while the game is paused, and start it again after. */
  setPaused(paused: boolean) {
    this.held = paused;
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  // ---------------------------------------------------------------- the instruments
  build(ctx: BaseAudioContext) {
    // everything goes through one gentle limiter, so nothing can clip however much is playing
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -14;
    limit.knee.value = 10;
    limit.ratio.value = 6;
    limit.attack.value = 0.004;
    limit.release.value = 0.2;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.85;
    this.out.connect(limit).connect(ctx.destination);
    // a hall: three seconds of fading noise, darker as it fades
    const length = Math.floor(ctx.sampleRate * 3);
    const hall = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = hall.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const k = i / length;
        last += (Math.random() * 2 - 1 - last) * (0.55 - 0.4 * k);
        data[i] = last * (1 - k) ** 2.4;
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = hall;
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 0.5;
    this.reverb.connect(conv).connect(this.out);
    // an echo, three sixteenths long, each repeat duller than the last
    const delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const back = ctx.createGain();
    back.gain.value = 0.42;
    const dull = ctx.createBiquadFilter();
    dull.type = 'lowpass';
    dull.frequency.value = 1500;
    this.echo = ctx.createGain();
    this.echo.gain.value = 1;
    this.echo.connect(delay).connect(dull).connect(back).connect(delay);
    dull.connect(this.out);
    dull.connect(this.reverb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    return this;
  }

  /** One note: a wave through a filter, swelling in and dying away, to the room and its echo and reverb. */
  private note(
    ctx: BaseAudioContext,
    o: { t: number; f: number; wave?: OscillatorType; len: number; vol: number; attack?: number; release?: number; cut?: number; cutTo?: number; q?: number; band?: boolean; detune?: number; bend?: number; rev?: number; echo?: number },
  ) {
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(o.f, o.t);
    if (o.bend) osc.frequency.exponentialRampToValueAtTime(o.bend, o.t + o.len);
    if (o.detune) osc.detune.value = o.detune;
    const amp = ctx.createGain();
    const attack = o.attack ?? 0.005;
    const release = o.release ?? 0.08;
    amp.gain.setValueAtTime(0, o.t);
    amp.gain.linearRampToValueAtTime(o.vol, o.t + attack);
    amp.gain.setTargetAtTime(0, o.t + Math.max(attack, o.len), release / 3);
    let head: AudioNode = osc;
    if (o.cut) {
      const filter = ctx.createBiquadFilter();
      filter.type = o.band ? 'bandpass' : 'lowpass';
      filter.Q.value = o.q ?? 0.8;
      filter.frequency.setValueAtTime(o.cut, o.t);
      if (o.cutTo) filter.frequency.exponentialRampToValueAtTime(o.cutTo, o.t + o.len);
      head = osc.connect(filter);
    }
    head.connect(amp);
    amp.connect(this.out);
    if (o.rev) this.send(ctx, amp, this.reverb, o.rev);
    if (o.echo) this.send(ctx, amp, this.echo, o.echo);
    osc.start(o.t);
    osc.stop(o.t + o.len + release * 2 + 0.05);
  }

  private send(ctx: BaseAudioContext, from: AudioNode, to: AudioNode, amount: number) {
    const g = ctx.createGain();
    g.gain.value = amount;
    from.connect(g).connect(to);
  }

  /** A breath of noise through a filter that can sweep: wind, splashes, taps and thumps are made of these. */
  private hiss(ctx: BaseAudioContext, o: { t: number; len: number; vol: number; cut: number; cutTo?: number; q?: number; type?: BiquadFilterType; attack?: number; rev?: number }) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type ?? 'bandpass';
    filter.Q.value = o.q ?? 1;
    filter.frequency.setValueAtTime(o.cut, o.t);
    if (o.cutTo) filter.frequency.exponentialRampToValueAtTime(o.cutTo, o.t + o.len);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, o.t);
    amp.gain.linearRampToValueAtTime(o.vol, o.t + (o.attack ?? 0.004));
    amp.gain.exponentialRampToValueAtTime(0.0001, o.t + o.len);
    src.connect(filter).connect(amp).connect(this.out);
    if (o.rev) this.send(ctx, amp, this.reverb, o.rev);
    src.start(o.t, Math.random());
    src.stop(o.t + o.len + 0.05);
  }

  // ---------------------------------------------------------------- the score
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // (a long sleep, such as a paused game, is not caught up on: the grid picks up from now)
    const due = Math.floor((ctx.currentTime - this.t0) / STEP);
    if (this.next < due) this.next = due + 1;
    while (this.t0 + this.next * STEP < ctx.currentTime + 0.16) {
      this.step(ctx, this.next, this.t0 + this.next * STEP, this.mode, this.close);
      this.next++;
    }
  }

  /** What every layer plays on one step of the grid. */
  step(ctx: BaseAudioContext, n: number, t: number, mode: Mode, close: number) {
    const barIndex = Math.floor(n / 16) % BARS.length;
    const bar = BARS[barIndex];
    const at = n % 16;
    if (mode === 'lost') return;
    if (mode === 'won') {
      // safe: the same key turned major, strings only, and a few slow bell notes
      if (at === 0 && barIndex % 2 === 0) for (const m of [50, 57, 66, 74]) this.strings(ctx, t, m, STEP * 34, 0.05);
      if (at % 8 === 0 && barIndex % 2 === 0) this.bell(ctx, t, [86, 90, 93, 98][(at / 8 + barIndex) % 4], 0.07);
      return;
    }
    if (mode === 'dash') {
      // the egg is going for the edge: everything stops but a heartbeat and one held, uneasy pair of notes
      if (at % 4 === 0) this.thump(ctx, t, 0.5);
      if (at % 4 === 1) this.thump(ctx, t, 0.28);
      if (at % 8 === 0) for (const m of [62, 63, 69]) this.strings(ctx, t, m, STEP * 9, 0.045, true);
      return;
    }
    // strings: one chord a bar, held, swelling in
    if (at === 0) for (const m of bar.pad) this.strings(ctx, t, m, STEP * 17, mode === 'quiet' ? 0.035 : 0.04 + 0.025 * close);
    // the high line: always there when it is quiet, and thinning out as the chase fills in
    for (const [b, s, m, len] of MOTIF) if (b === barIndex && s === at && (mode === 'quiet' || close < 0.8)) this.bell(ctx, t, m, 0.06, STEP * len);
    if (mode === 'quiet') return;
    // brooding bass: a long note on the first and third beats, with its echo doing the rest
    if (at === 0 || at === 8) {
      this.note(ctx, { t, f: hz(bar.bass), wave: 'sawtooth', len: STEP * 6, vol: 0.2, attack: 0.02, release: 0.5, cut: 520, cutTo: 190, q: 2, echo: 0.3, rev: 0.15 });
      this.note(ctx, { t, f: hz(bar.bass + 12), wave: 'square', len: STEP * 5, vol: 0.07, attack: 0.02, release: 0.4, cut: 900, cutTo: 300, echo: 0.35 });
    }
    // the pulse: three, three, two
    if (close > 0.12 && PULSE.includes(at)) this.thump(ctx, t, 0.3 + 0.25 * close);
    // a second bass, short notes on every eighth: the pace
    if (close > 0.3 && at % 2 === 0) {
      const loud = PULSE.includes(at) ? 1 : 0.6;
      this.note(ctx, { t, f: hz(bar.bass + 12), wave: 'sawtooth', len: 0.09, vol: 0.085 * loud * Math.min(1, (close - 0.3) * 4), release: 0.1, cut: 1100, cutTo: 260, q: 3, echo: 0.25 });
    }
    // strings again, short and sharp on every sixteenth, when the egg is nearly in reach
    if (close > 0.55) {
      const m = bar.pad[[0, 2, 1, 2, 0, 2, 1, 2][at % 8]] + 12;
      this.note(ctx, { t, f: hz(m), wave: 'sawtooth', len: 0.05, vol: (at % 4 === 0 ? 0.05 : 0.032) * Math.min(1, (close - 0.55) * 4), release: 0.07, cut: 2200, q: 1.2, band: true, rev: 0.25 });
    }
    // and a shaker on the off-beats at the very end
    if (close > 0.78 && at % 2 === 1) this.hiss(ctx, { t, len: 0.04, vol: 0.03, cut: 7500, type: 'highpass' });
  }

  private strings(ctx: BaseAudioContext, t: number, midi: number, len: number, vol: number, shake = false) {
    // two saws a few cents apart, filtered dark, swelling in slowly: near enough to a section of strings for a sketch
    for (const detune of [-7, 6]) this.note(ctx, { t, f: hz(midi), wave: 'sawtooth', detune, len, vol, attack: shake ? 0.06 : 0.45, release: 0.9, cut: shake ? 1900 : 1250, q: 0.5, rev: 0.6 });
  }

  private bell(ctx: BaseAudioContext, t: number, midi: number, vol: number, len = 0.5) {
    this.note(ctx, { t, f: hz(midi), len: Math.min(len, 0.25), vol, release: 1.6, rev: 0.9, echo: 0.3 });
    this.note(ctx, { t, f: hz(midi) * 3.01, len: 0.04, vol: vol * 0.25, release: 0.3, rev: 0.6 });
  }

  private thump(ctx: BaseAudioContext, t: number, vol: number) {
    // low enough to feel on headphones, with a knock on top that a phone's speaker can play
    this.note(ctx, { t, f: 190, bend: 52, len: 0.16, vol, release: 0.08 });
    this.hiss(ctx, { t, len: 0.035, vol: vol * 0.35, cut: 900, q: 0.7 });
  }

  private pluck(ctx: BaseAudioContext, t: number, midi: number, vol: number, long = false) {
    // a struck bar, like a marimba: the amber's voice
    this.note(ctx, { t, f: hz(midi), len: 0.03, vol, release: long ? 1.4 : 0.5, rev: 0.45, echo: 0.22 });
    this.note(ctx, { t, f: hz(midi) * 4, len: 0.01, vol: vol * 0.3, release: 0.09 });
    this.note(ctx, { t, f: hz(midi - 12), wave: 'triangle', len: 0.02, vol: vol * 0.35, release: 0.3 });
  }

  // ---------------------------------------------------------------- what the game tells it
  /** Which music is playing: the quiet of the nest, the chase, the egg's dash for the edge, safe, or lost. */
  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.amberRung = 0;
  }

  /** How close the runner is to the egg, 0 to 1. More of the band plays the closer it is. */
  setClose(close: number) {
    this.close = close;
  }

  /** The time of the next step of the grid, and its number, for anything that should land on the beat. */
  private onGrid(every = 1): [number, number] | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    let n = Math.ceil((ctx.currentTime + 0.012 - this.t0) / STEP);
    n += (every - (n % every)) % every;
    return [this.t0 + n * STEP, n];
  }

  /** A piece of amber: one note on the next step of the grid, from the bar's chord, climbing as a line is collected. */
  amber() {
    const g = this.onGrid();
    if (!g || !this.ctx) return;
    const [t, n] = g;
    if (n === this.amberStep) return; // several at once (the fans are out) are one note
    // a new line starts again from the bottom
    if (t - this.amberAt > STEP * 5) this.amberRung = 0;
    const ladder = BARS[Math.floor(n / 16) % BARS.length].amber;
    this.pluck(this.ctx, t, ladder[this.amberRung % ladder.length], 0.26);
    this.amberRung++;
    this.amberStep = n;
    this.amberAt = t;
  }

  /** A hidden find: two notes on the next eighth, ringing on. */
  find() {
    const g = this.onGrid(2);
    if (!g || !this.ctx) return;
    const ladder = BARS[Math.floor(g[1] / 16) % BARS.length].amber;
    this.pluck(this.ctx, g[0], ladder[2], 0.26, true);
    this.pluck(this.ctx, g[0] + STEP, ladder[4], 0.26, true);
    this.pluck(this.ctx, g[0] + STEP * 2, ladder[2] + 12, 0.22, true);
  }

  /** The golden leaf: a quick run up the chord. */
  leaf() {
    const g = this.onGrid();
    if (!g || !this.ctx) return;
    const ladder = BARS[Math.floor(g[1] / 16) % BARS.length].amber;
    ladder.forEach((m, i) => this.pluck(this.ctx!, g[0] + i * STEP * 0.5, m, 0.16, true));
  }

  private now(): [AudioContext, number] | null {
    return this.ctx && this.ctx.state === 'running' ? [this.ctx, this.ctx.currentTime + 0.005] : null;
  }

  jump() {
    const c = this.now();
    if (c) this.hiss(c[0], { t: c[1], len: 0.22, vol: 0.09, cut: 500, cutTo: 1900, q: 1.4 });
  }

  slide() {
    const c = this.now();
    if (c) this.hiss(c[0], { t: c[1], len: 0.36, vol: 0.1, cut: 2600, cutTo: 500, q: 0.9 });
  }

  step_() {
    const c = this.now();
    if (c) this.hiss(c[0], { t: c[1], len: 0.07, vol: 0.035, cut: 1500, q: 2 });
  }

  bump() {
    const c = this.now();
    if (!c) return;
    this.note(c[0], { t: c[1], f: 150, bend: 48, len: 0.2, vol: 0.5, release: 0.1 });
    this.hiss(c[0], { t: c[1], len: 0.16, vol: 0.22, cut: 700, q: 0.6, rev: 0.3 });
  }

  splash() {
    const c = this.now();
    if (!c) return;
    this.hiss(c[0], { t: c[1], len: 0.4, vol: 0.2, cut: 2400, cutTo: 900, q: 0.7, rev: 0.4 });
    this.hiss(c[0], { t: c[1] + 0.05, len: 0.25, vol: 0.1, cut: 5200, type: 'highpass' });
  }

  /** A tap on the shell from inside: harder as `hard` goes from 0 to 1. */
  tap(hard: number) {
    const c = this.now();
    if (!c) return;
    for (const d of [0, 0.11]) {
      this.note(c[0], { t: c[1] + d, f: 950 + hard * 250, bend: 520, len: 0.03, vol: 0.12 + hard * 0.12, release: 0.04, rev: 0.25 });
      this.hiss(c[0], { t: c[1] + d, len: 0.02, vol: 0.06 + hard * 0.06, cut: 3200, q: 1.5 });
    }
  }

  /** The shell breaking. */
  crack() {
    const c = this.now();
    if (!c) return;
    for (let i = 0; i < 5; i++) this.hiss(c[0], { t: c[1] + i * 0.028 + Math.random() * 0.01, len: 0.03, vol: 0.14, cut: 2600 + Math.random() * 2600, q: 2.5, rev: 0.2 });
  }

  /** The egg setting off down the slope: a rumble that gathers. */
  roll() {
    const c = this.now();
    if (c) this.hiss(c[0], { t: c[1], len: 1.6, vol: 0.16, cut: 140, cutTo: 420, q: 0.8, attack: 0.9 });
  }

  /** The chick's first calls. */
  peep() {
    const c = this.now();
    if (!c) return;
    for (const d of [0, 0.16]) this.note(c[0], { t: c[1] + d, f: 2700, bend: 3500, len: 0.07, vol: 0.09, attack: 0.01, release: 0.05, rev: 0.3 });
  }

  /** The catch: everything lands at once, and then the key turns major. */
  caught() {
    const c = this.now();
    this.setMode('won');
    if (!c) return;
    this.note(c[0], { t: c[1], f: 120, bend: 40, len: 0.3, vol: 0.6, release: 0.2 });
    this.hiss(c[0], { t: c[1], len: 1.4, vol: 0.16, cut: 5000, cutTo: 900, q: 0.5, rev: 0.6 });
    for (const m of [50, 57, 62, 66, 74]) this.strings(c[0], c[1] + 0.25, m, 5, 0.055);
  }

  /** Too late, or lost on the way down: the music falls away. */
  lost() {
    const c = this.now();
    this.setMode('lost');
    if (!c) return;
    this.note(c[0], { t: c[1], f: hz(62), bend: hz(50), wave: 'triangle', len: 1.3, vol: 0.14, attack: 0.05, release: 0.6, rev: 0.7 });
    for (const m of [38, 41, 44]) this.strings(c[0], c[1] + 0.2, m + 12, 2.2, 0.035);
  }
}
