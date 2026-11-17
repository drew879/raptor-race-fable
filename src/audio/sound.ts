// Music and sound, played by the browser as the game runs: nothing is recorded.
//
// SECOND SKETCH, still written without being able to hear it. The timing, the notes and the
// levels are checked by measurement; whether it sounds right is for Drew's ears.
//
// His direction: dark, intense and driving, a chase: a steady kick drum, a bass line with a
// groove to it, brooding synths with echo and reverb, ominous strings. And the amber is part
// of the music: collecting it plays the tune.
//
// How it works. Time is a grid of sixteenth notes. In the chase the grid is tied to the
// GROUND, not the clock: one sixteenth for every meter of trail. At the usual 8 m/s that is
// 120 beats a minute; a faster or slower Speed setting is a faster or slower tempo; and when
// the runner bumps into something and stops, the music stops with it and picks up where it
// left off. Every place on the trail is therefore a place in the music, which is what will let
// the level be laid out to the song. Each piece of amber plays the tune's note for the spot it
// lies on. Away from the chase (the nest, the egg's last dash, the hatching) the grid runs on
// the clock.

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Meters of trail to a sixteenth note in the chase. */
const METERS_PER_STEP = 1;
/** Seconds to a sixteenth note when the music runs on the clock. */
const STEP = 0.125;

/** Eight bars in D minor. Each: the bass's root, the strings' four notes, and the tune in eighth notes (0 is a rest). */
const BARS = [
  { root: 38, pad: [50, 57, 62, 65], tune: [74, 0, 77, 0, 81, 79, 77, 76] }, // D minor
  { root: 38, pad: [50, 57, 62, 65], tune: [74, 0, 74, 76, 77, 0, 81, 0] },
  { root: 34, pad: [50, 58, 62, 65], tune: [82, 0, 81, 0, 77, 79, 81, 0] }, // B flat
  { root: 33, pad: [49, 57, 61, 64], tune: [81, 0, 76, 0, 73, 76, 69, 0] }, // A: the pull back home
  { root: 38, pad: [50, 57, 62, 65], tune: [74, 0, 77, 0, 81, 79, 77, 76] },
  { root: 36, pad: [48, 55, 60, 64], tune: [76, 0, 79, 0, 84, 82, 79, 76] }, // C
  { root: 39, pad: [51, 58, 63, 67], tune: [75, 0, 79, 0, 82, 81, 79, 75] }, // E flat: the uneasy one
  { root: 33, pad: [49, 57, 61, 64], tune: [76, 0, 73, 0, 69, 73, 76, 0] }, // A
];
const barAt = (n: number) => BARS[((Math.floor(n / 16) % BARS.length) + BARS.length) % BARS.length];
const stepIn = (n: number) => ((n % 16) + 16) % 16;
/** The bass line, the same shape in every bar: [sixteenth, semitones above the root, length in sixteenths]. Off the beat as often as on it. */
const GROOVE: [number, number, number][] = [[0, 0, 2], [3, 0, 1], [6, 12, 1], [8, 0, 2], [11, 7, 1], [12, 12, 1], [14, 7, 2]];

type Mode = 'quiet' | 'chase' | 'dash' | 'won' | 'lost';
interface NoteOpts {
  t: number;
  f: number;
  wave?: OscillatorType;
  len: number;
  vol: number;
  attack?: number;
  release?: number;
  cut?: number;
  cutTo?: number;
  q?: number;
  band?: boolean;
  detune?: number;
  bend?: number;
  rev?: number;
  echo?: number;
  to?: AudioNode;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private grit!: GainNode; // the bass goes through this: a little overdrive, so a phone's speaker can play it
  private reverb!: GainNode;
  private echo!: GainNode;
  private noise!: AudioBuffer;
  private silent: HTMLAudioElement | null = null;
  private timer = 0;
  private stale = false;
  private held = false;
  private muted = false;
  private mode: Mode = 'quiet';
  /** 0 far behind the egg, 1 right on it: how much of the band is playing. */
  private close = 0;
  // the clock's grid
  private t0 = 0;
  private next = 0;
  // the ground's grid
  /** Where on the trail the music starts. */
  origin = 0;
  private groundNext = -1;
  private lastS = 0;
  private lastV = 0;
  private amberStep = -1e9;

  constructor() {
    try {
      this.muted = localStorage.getItem('rr-sound1') === '0';
    } catch {
      /* private mode */
    }
    // Browsers only let sound start from a tap, and on an iPhone only from the end of one.
    const unlock = () => this.unlock();
    for (const type of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(type, unlock, { passive: true });
    // An iPhone cuts the sound off when the app is left, and what it leaves behind will not
    // always start again. So after any time away, the next tap makes everything afresh.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stale = true;
    });
    window.addEventListener('pagehide', () => (this.stale = true));
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

  /** Start the sound, or start it again after time away. Called at the end of every tap. */
  private unlock() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx || this.stale) {
      this.stale = false;
      const old = this.ctx;
      if (old) void old.close().catch(() => undefined);
      window.clearInterval(this.timer);
      this.ctx = new Ctx();
      this.build(this.ctx);
      this.t0 = this.ctx.currentTime + 0.1;
      this.next = 0;
      this.groundNext = -1;
      this.amberStep = -1e9;
      this.timer = window.setInterval(() => this.schedule(), 30);
    }
    if (!this.silent) {
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
      this.silent = new Audio(`data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`);
      this.silent.loop = true;
      this.silent.setAttribute('playsinline', '');
    }
    if (this.silent.paused) void this.silent.play().catch(() => undefined);
    if (this.held) {
      if (this.ctx.state === 'running') void this.ctx.suspend();
    } else if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  /** Stop the clock while the game is paused, and start it again after. */
  setPaused(paused: boolean) {
    this.held = paused;
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  // ---------------------------------------------------------------- the instruments
  build(ctx: BaseAudioContext) {
    // everything goes through one limiter, so nothing can clip however much is playing
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -12;
    limit.knee.value = 8;
    limit.ratio.value = 8;
    limit.attack.value = 0.003;
    limit.release.value = 0.16;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.85;
    this.out.connect(limit).connect(ctx.destination);
    // overdrive for the bass: it adds the higher tones a small speaker can play, and some menace
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(513);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / 256 - 1) * 3.2));
    drive.curve = curve;
    drive.oversample = '2x';
    const tame = ctx.createBiquadFilter();
    tame.type = 'lowpass';
    tame.frequency.value = 2600;
    this.grit = ctx.createGain();
    this.grit.gain.value = 1.6;
    const gritOut = ctx.createGain();
    gritOut.gain.value = 0.19;
    this.grit.connect(drive).connect(tame).connect(gritOut).connect(this.out);
    // a hall: three seconds of fading noise, darker as it fades
    const length = Math.floor(ctx.sampleRate * 3);
    const hall = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = hall.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const k = i / length;
        last += (Math.random() * 2 - 1 - last) * (0.5 - 0.38 * k);
        data[i] = last * (1 - k) ** 2.4;
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = hall;
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 0.5;
    this.reverb.connect(conv).connect(this.out);
    // an echo, three sixteenths long at the usual tempo, each repeat duller than the last
    const delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const back = ctx.createGain();
    back.gain.value = 0.45;
    const dull = ctx.createBiquadFilter();
    dull.type = 'lowpass';
    dull.frequency.value = 1400;
    this.echo = ctx.createGain();
    this.echo.connect(delay).connect(dull).connect(back).connect(delay);
    dull.connect(this.out);
    dull.connect(this.reverb);
    gritOut.connect(this.echo); // (the bass is the thing that echoes)
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    return this;
  }

  /** One note: a wave through a filter, swelling in and dying away. */
  private note(ctx: BaseAudioContext, o: NoteOpts) {
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(o.f, o.t);
    if (o.bend) osc.frequency.exponentialRampToValueAtTime(o.bend, o.t + o.len);
    if (o.detune) osc.detune.value = o.detune;
    const amp = ctx.createGain();
    const attack = o.attack ?? 0.004;
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
    amp.connect(o.to ?? this.out);
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

  /** A breath of noise through a filter that can sweep: drums, wind, skids and splashes are made of these. */
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
    amp.gain.linearRampToValueAtTime(o.vol, o.t + (o.attack ?? 0.003));
    amp.gain.exponentialRampToValueAtTime(0.0001, o.t + o.len);
    src.connect(filter).connect(amp).connect(this.out);
    if (o.rev) this.send(ctx, amp, this.reverb, o.rev);
    src.start(o.t, Math.random());
    src.stop(o.t + o.len + 0.05);
  }

  private kick(ctx: BaseAudioContext, t: number, vol: number) {
    // the low part for headphones, and a knock and a click on top that a phone's speaker can play
    this.note(ctx, { t, f: 150, bend: 44, len: 0.15, vol, release: 0.07 });
    this.note(ctx, { t, f: 330, bend: 140, wave: 'triangle', len: 0.045, vol: vol * 0.55, release: 0.03 });
    this.hiss(ctx, { t, len: 0.014, vol: vol * 0.3, cut: 2800, q: 0.8 });
  }

  private snare(ctx: BaseAudioContext, t: number, vol: number) {
    this.hiss(ctx, { t, len: 0.15, vol, cut: 1900, q: 0.7, rev: 0.3 });
    this.note(ctx, { t, f: 200, bend: 150, wave: 'triangle', len: 0.07, vol: vol * 0.5, release: 0.05 });
  }

  private strings(ctx: BaseAudioContext, t: number, midi: number, len: number, vol: number, bright = false) {
    // two saws a few cents apart, filtered dark: near enough to a section of strings for a sketch
    for (const detune of [-8, 7]) this.note(ctx, { t, f: hz(midi), wave: 'sawtooth', detune, len, vol, attack: bright ? 0.05 : 0.3, release: 0.7, cut: bright ? 2100 : 950, q: 0.6, rev: 0.6 });
  }

  private bell(ctx: BaseAudioContext, t: number, midi: number, vol: number) {
    this.note(ctx, { t, f: hz(midi), len: 0.2, vol, release: 1.6, rev: 0.9, echo: 0.3 });
    this.note(ctx, { t, f: hz(midi) * 3.01, len: 0.04, vol: vol * 0.25, release: 0.3, rev: 0.6 });
  }

  private pluck(ctx: BaseAudioContext, t: number, midi: number, vol: number, long = false) {
    // a struck bar with a hard edge, like a marimba played with a hard mallet: the amber's voice
    this.note(ctx, { t, f: hz(midi), len: 0.03, vol, release: long ? 1.4 : 0.45, rev: 0.4, echo: 0.2 });
    this.note(ctx, { t, f: hz(midi) * 4, len: 0.01, vol: vol * 0.32, release: 0.09 });
    this.note(ctx, { t, f: hz(midi), wave: 'triangle', len: 0.02, vol: vol * 0.45, release: 0.2 });
  }

  // ---------------------------------------------------------------- the score
  /** What every layer of the chase plays on one sixteenth. */
  step(ctx: BaseAudioContext, n: number, t: number, close: number) {
    const bar = barAt(n);
    const at = stepIn(n);
    const beat = at % 4 === 0;
    // the kick, on every beat, from the first step to the last: the chase's heartbeat
    if (beat) this.kick(ctx, t, 0.3);
    // the bass line
    for (const [s, up, len] of GROOVE) {
      if (s !== at) continue;
      const f = hz(bar.root + up);
      // (an octave and two octaves above the true bass note as well: those are what a phone's speaker plays)
      this.note(ctx, { t, f: f * 2, wave: 'sawtooth', len: len * 0.11, vol: 0.2, release: 0.07, cut: 1900, cutTo: 480, q: 4, to: this.grit });
      this.note(ctx, { t, f: f * 4, wave: 'sawtooth', len: len * 0.11, vol: 0.09, release: 0.06, cut: 2400, cutTo: 700, q: 2, to: this.grit });
      this.note(ctx, { t, f, wave: 'square', len: len * 0.11, vol: 0.09, release: 0.07, cut: 900, cutTo: 260, to: this.grit });
    }
    // a low drone under it all, one long note every two bars, left to echo
    if (at === 0 && Math.floor(n / 16) % 2 === 0) this.note(ctx, { t, f: hz(bar.root + 12), wave: 'sawtooth', len: 3.2, vol: 0.045, attack: 0.6, release: 1.2, cut: 260, cutTo: 620, q: 3, rev: 0.5, echo: 0.4 });
    // ominous strings: one dark chord a bar
    if (at === 0) for (const m of bar.pad) this.strings(ctx, t, m, 1.85, 0.03 + 0.035 * close);
    // off-beat ticks, to keep it moving
    if (at % 4 === 2) this.hiss(ctx, { t, len: 0.035, vol: 0.08, cut: 7000, type: 'highpass' });
    // ---- and more of the band the closer the egg is
    if (close > 0.25 && (at === 4 || at === 12)) this.snare(ctx, t, 0.34 + 0.2 * close);
    if (close > 0.45 && at % 2 === 0) {
      // strings, short and sharp on every eighth
      const m = bar.pad[[0, 1, 2, 1, 3, 1, 2, 1][at / 2]] + 12;
      this.note(ctx, { t, f: hz(m), wave: 'sawtooth', len: 0.06, vol: (beat ? 0.2 : 0.14) * Math.min(1, (close - 0.45) * 5), release: 0.08, cut: 2000, q: 1.2, band: true, rev: 0.3 });
    }
    if (close > 0.65) {
      // sixteenths on the hat, and the strings shaking
      if (at % 2 === 1) this.hiss(ctx, { t, len: 0.025, vol: 0.07, cut: 8500, type: 'highpass' });
      this.note(ctx, { t, f: hz(bar.pad[3] + 12), wave: 'sawtooth', len: 0.05, vol: 0.06, release: 0.05, cut: 2600, q: 0.8, rev: 0.4 });
    }
    if (close > 0.85 && at === 14) this.kick(ctx, t, 0.2);
  }

  /** The music away from the chase, on the clock. */
  private free(ctx: BaseAudioContext, n: number, t: number) {
    const bar = barAt(n);
    const at = stepIn(n);
    const barIndex = Math.floor(n / 16) % BARS.length;
    if (this.mode === 'lost' || this.mode === 'chase') return;
    if (this.mode === 'won') {
      // safe: the same key turned major, strings only, and a few slow bell notes
      if (at === 0 && barIndex % 2 === 0) for (const m of [50, 57, 66, 74]) this.strings(ctx, t, m, 4.2, 0.045);
      if (at % 8 === 0 && barIndex % 2 === 0) this.bell(ctx, t, [86, 90, 93, 98][(at / 8 + barIndex) % 4], 0.07);
      return;
    }
    if (this.mode === 'dash') {
      // the egg is going for the edge: a racing heartbeat and one held, uneasy handful of notes
      if (at % 4 === 0) this.kick(ctx, t, 0.55);
      if (at % 4 === 1) this.kick(ctx, t, 0.3);
      if (at % 8 === 0) for (const m of [62, 63, 69]) this.strings(ctx, t, m, 1.1, 0.04, true);
      return;
    }
    // the nest: dark strings, the drone, and a few high notes a half-step apart
    if (at === 0) for (const m of bar.pad) this.strings(ctx, t, m, 1.9, 0.026);
    if (at === 0 && barIndex % 2 === 0) this.note(ctx, { t, f: hz(bar.root + 12), wave: 'sawtooth', len: 3.2, vol: 0.04, attack: 0.8, release: 1.2, cut: 240, cutTo: 520, q: 3, rev: 0.5, echo: 0.4 });
    for (const [b, s, m] of [[0, 0, 81], [0, 12, 82], [1, 0, 81], [4, 0, 86], [4, 12, 85], [5, 4, 81]]) if (b === barIndex && s === at) this.bell(ctx, t, m, 0.055);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // (a long sleep, such as a paused game, is not caught up on: the grid picks up from now)
    const due = Math.floor((ctx.currentTime - this.t0) / STEP);
    if (this.next < due) this.next = due + 1;
    while (this.t0 + this.next * STEP < ctx.currentTime + 0.16) {
      this.free(ctx, this.next, this.t0 + this.next * STEP);
      this.next++;
    }
  }

  /**
   * The chase's music follows the runner: call this every frame with where it is on the trail
   * and how fast it is really moving. Each sixteenth is played as the runner reaches its meter.
   */
  drive(s: number, v: number) {
    this.lastS = s;
    this.lastV = v;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.mode !== 'chase') return;
    const pos = (s - this.origin) / METERS_PER_STEP;
    // starting out, or after being put back somewhere else on the trail
    if (this.groundNext < 0 || this.groundNext < pos - 1 || this.groundNext > pos + 6) this.groundNext = Math.ceil(pos);
    while (v > 0.8) {
      const wait = ((this.groundNext - pos) * METERS_PER_STEP) / v;
      if (wait > 0.14) break;
      this.step(ctx, this.groundNext, ctx.currentTime + Math.max(wait, 0.005), this.close);
      this.groundNext++;
    }
  }

  // ---------------------------------------------------------------- what the game tells it
  /** Which music is playing: the quiet of the nest, the chase, the egg's dash for the edge, safe, or lost. */
  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.groundNext = -1;
  }

  /** How close the runner is to the egg, 0 to 1. More of the band plays the closer it is. */
  setClose(close: number) {
    this.close = close;
  }

  /** The step of the grid that is coming next, and when: for anything that should land on the beat. */
  private onGrid(): [number, number] | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    if (this.mode === 'chase' && this.lastV > 0.8) {
      const pos = (this.lastS - this.origin) / METERS_PER_STEP;
      const n = Math.ceil(pos + 0.05);
      return [ctx.currentTime + Math.min(0.2, ((n - pos) * METERS_PER_STEP) / this.lastV), n];
    }
    const n = Math.ceil((ctx.currentTime + 0.012 - this.t0) / STEP);
    return [this.t0 + n * STEP, n];
  }

  /**
   * A piece of amber, lying at `at` meters along the trail. It plays the tune's note for that
   * spot, on the grid. A line of amber plays a phrase; a missed piece is a missing note.
   */
  amber(at?: number) {
    const ctx = this.ctx;
    const g = this.onGrid();
    if (!ctx || !g) return;
    let [t, n] = g;
    if (at !== undefined && this.mode === 'chase' && this.lastV > 0.8) {
      // its own place on the grid, which the runner is just reaching
      const pos = (this.lastS - this.origin) / METERS_PER_STEP;
      n = Math.round((at - this.origin) / METERS_PER_STEP);
      t = ctx.currentTime + Math.min(0.2, Math.max(0.004, ((n - pos) * METERS_PER_STEP) / this.lastV));
    }
    if (n === this.amberStep) return; // several at once (the fans are out) are one note
    this.amberStep = n;
    const bar = barAt(n);
    const tune = bar.tune[Math.floor(stepIn(n) / 2)];
    // where the tune rests, the amber still answers, quietly, with a note of the chord
    if (tune) this.pluck(ctx, t, tune, stepIn(n) % 2 ? 0.17 : 0.25);
    else this.pluck(ctx, t, bar.pad[2] + 12, 0.07);
  }

  /** A hidden find: three notes up the chord, ringing on. */
  find() {
    const g = this.onGrid();
    if (!g || !this.ctx) return;
    const pad = barAt(g[1]).pad;
    [pad[1] + 12, pad[3] + 12, pad[1] + 24].forEach((m, i) => this.pluck(this.ctx!, g[0] + i * STEP, m, 0.24, true));
  }

  /** The golden leaf: a quick run up the chord. */
  leaf() {
    const g = this.onGrid();
    if (!g || !this.ctx) return;
    const pad = barAt(g[1]).pad;
    [pad[0], pad[1], pad[2], pad[3], pad[0] + 12].forEach((m, i) => this.pluck(this.ctx!, g[0] + i * STEP * 0.5, m + 12, 0.16, true));
  }

  private now(): [AudioContext, number] | null {
    return this.ctx && this.ctx.state === 'running' ? [this.ctx, this.ctx.currentTime + 0.005] : null;
  }

  /**
   * A jump: a whoosh. Air and feathers, no note. (It was a rising note, which Drew heard as "the
   * sound I'd expect Yoshi to make in a Mario game, not a feathered dinosaur in this game".)
   */
  jump() {
    const c = this.now();
    if (!c) return;
    // the body of it, sweeping up as the runner leaves the ground, and the hiss of air over the top
    this.hiss(c[0], { t: c[1], len: 0.34, vol: 0.34, cut: 380, cutTo: 1900, q: 0.9, attack: 0.05 });
    this.hiss(c[0], { t: c[1] + 0.03, len: 0.28, vol: 0.14, cut: 2600, cutTo: 6500, q: 0.7, attack: 0.06, rev: 0.2 });
    // and one soft beat of the fans
    this.hiss(c[0], { t: c[1], len: 0.07, vol: 0.2, cut: 240, q: 0.8, attack: 0.008 });
  }

  /** A slide: a skid, grinding down. */
  slide() {
    const c = this.now();
    if (!c) return;
    // the long scrape, falling in pitch, with a rough edge of short bursts over it
    this.hiss(c[0], { t: c[1], len: 0.55, vol: 0.3, cut: 1500, cutTo: 380, q: 1.6, attack: 0.02 });
    for (let i = 0; i < 7; i++) this.hiss(c[0], { t: c[1] + i * 0.055, len: 0.04, vol: 0.14 * (1 - i / 9), cut: 3200 - i * 260, q: 2.5 });
    this.note(c[0], { t: c[1], f: hz(57), bend: hz(45), wave: 'sawtooth', len: 0.45, vol: 0.08, attack: 0.02, release: 0.1, cut: 700, cutTo: 300, q: 2 });
  }

  /** A step across to another lane. */
  step_() {
    const c = this.now();
    if (c) this.hiss(c[0], { t: c[1], len: 0.08, vol: 0.06, cut: 1500, q: 2 });
  }

  bump() {
    const c = this.now();
    if (!c) return;
    this.note(c[0], { t: c[1], f: 150, bend: 48, len: 0.2, vol: 0.55, release: 0.1 });
    this.hiss(c[0], { t: c[1], len: 0.16, vol: 0.24, cut: 700, q: 0.6, rev: 0.3 });
  }

  splash() {
    const c = this.now();
    if (!c) return;
    this.hiss(c[0], { t: c[1], len: 0.4, vol: 0.22, cut: 2400, cutTo: 900, q: 0.7, rev: 0.4 });
    this.hiss(c[0], { t: c[1] + 0.05, len: 0.25, vol: 0.1, cut: 5200, type: 'highpass' });
  }

  /** A tap on the shell from inside: harder as `hard` goes from 0 to 1. */
  tap(hard: number) {
    const c = this.now();
    if (!c) return;
    for (const d of [0, 0.11]) {
      this.note(c[0], { t: c[1] + d, f: 950 + hard * 250, bend: 520, len: 0.03, vol: 0.14 + hard * 0.12, release: 0.04, rev: 0.25 });
      this.hiss(c[0], { t: c[1] + d, len: 0.02, vol: 0.07 + hard * 0.06, cut: 3200, q: 1.5 });
    }
  }

  /** The shell breaking. */
  crack() {
    const c = this.now();
    if (!c) return;
    for (let i = 0; i < 5; i++) this.hiss(c[0], { t: c[1] + i * 0.028 + Math.random() * 0.01, len: 0.03, vol: 0.16, cut: 2600 + Math.random() * 2600, q: 2.5, rev: 0.2 });
  }

  /** The egg setting off down the slope: a rumble that gathers. */
  roll() {
    const c = this.now();
    if (c) this.hiss(c[0], { t: c[1], len: 1.6, vol: 0.2, cut: 180, cutTo: 520, q: 0.8, attack: 0.9 });
  }

  /** The chick's first calls. */
  peep() {
    const c = this.now();
    if (!c) return;
    for (const d of [0, 0.16]) this.note(c[0], { t: c[1] + d, f: 2700, bend: 3500, len: 0.07, vol: 0.1, attack: 0.01, release: 0.05, rev: 0.3 });
  }

  /** The catch: everything lands at once, and then the key turns major. */
  caught() {
    const c = this.now();
    this.setMode('won');
    if (!c) return;
    this.kick(c[0], c[1], 0.7);
    this.hiss(c[0], { t: c[1], len: 1.4, vol: 0.16, cut: 5000, cutTo: 900, q: 0.5, rev: 0.6 });
    for (const m of [50, 57, 62, 66, 74]) this.strings(c[0], c[1] + 0.25, m, 5, 0.05);
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
