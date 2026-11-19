// Music and sound, played by the browser as the game runs: nothing is recorded.
//
// The chase music is "Chase Strings", the piece from the earlier version of the game, which
// Drew preferred to both sketches written for this one. It is rebuilt here from his written
// description of it, part by part and number by number, and checked by measurement against
// the 34 second clip of the original (docs/local, off the repo; see the notes). It is still
// written without being able to hear it: whether it sounds right is for Drew's ears.
//
// The piece: C sharp minor with a major chord on G sharp, 120 beats a minute, eight bars.
// Short string notes in sixteenths on the root, the fifth and the octave; cellos on beats one
// and three; a small drum kit; a violin tune; high shaking strings at the top of the chase. How
// much of it plays is one number, the intensity, from 0 to 1.
//
// How it works. Time is a grid of sixteenth notes. In the chase the grid is tied to the
// GROUND, not the clock: one sixteenth for every meter of trail. At the usual 8 m/s that is
// 120 beats a minute; a faster or slower Speed setting is a faster or slower tempo; and when
// the runner bumps into something and stops, the music stops with it and picks up where it
// left off. Every place on the trail is therefore a place in the music, which is what will let
// the level be laid out to the song.
//
// The amber has a part of its own: a line of bells with a note written for every eighth of
// the eight bars. A piece plays the note written for the spot it lies on, so a line of amber
// is a phrase, the same one every time, and a missed piece is a missing note. The level, not
// the line, decides where the rests are.

import { fetchLayers, LAYER_NAMES, type LayerFiles, type LayerName, type Layers } from './layers';

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Meters of trail to a sixteenth note in the chase. */
const METERS_PER_STEP = 1;
/** Seconds to a sixteenth note when the music runs on the clock. */
const STEP = 0.125;
/** How loud the music is against everything else. */
const MUSIC = 1.4;
/**
 * The levels in Drew's description are the original's own numbers. Measured against the clip of
 * the original, part by part, this band's strings came out 2 dB under its drums, its hats 3.6 dB
 * under and its bells 1.6 dB over, and its wind was far too quiet. These put that right.
 */
const BOWED = 1.26;
const HATS = 1.5;
const BELLS = 0.83;
/**
 * What a piece of amber sounds like. The bell is the first one: a sine, gone in a tenth of a
 * second. The others are struck bars and tines, each built from the few pure tones such a thing
 * really rings with, dying away at their own speeds, and the knock of what struck it.
 * `tones` are [how many times the note's pitch, how loud, seconds to die away]; `knock` is the
 * strike: [where its noise is centred in Hz, how loud, how long, 'lowpass' for a soft mallet].
 * `level` evens the voices out: each one's strike measures about 1.5 dB over the bell's (its
 * loudest twentieth of a second, K-weighted), since a mellower sound needs a little more to be noticed.
 */
const VOICES = {
  bell: { level: 1, tones: [] as number[][], knock: null as null | [number, number, number, BiquadFilterType] },
  // a rosewood bar and a hard mallet: the second tone of a xylophone's bar is tuned a twelfth up
  xylophone: { level: 0.84, tones: [[1, 1, 0.26], [3, 0.34, 0.1], [6, 0.1, 0.045]], knock: [4200, 0.22, 0.012, 'bandpass'] as [number, number, number, BiquadFilterType] },
  // a longer bar over a tube, and a soft mallet: warmer, the second tone two octaves up and faint
  marimba: { level: 0.76, tones: [[1, 1, 0.42], [4, 0.15, 0.09], [9.2, 0.035, 0.03]], knock: [1300, 0.2, 0.022, 'lowpass'] as [number, number, number, BiquadFilterType] },
  // a steel tine over a small wooden box: round, with the box's octave under a high faint ping
  kalimba: { level: 0.73, tones: [[1, 1, 0.5], [2, 0.16, 0.2], [6.27, 0.1, 0.06]], knock: [2600, 0.16, 0.008, 'bandpass'] as [number, number, number, BiquadFilterType] },
};
export type Voice = keyof typeof VOICES;
const VOICE_NAMES = Object.keys(VOICES) as Voice[];
/** The two drum mixes on trial: how much louder the second is than the first. */
const DRUMS_LOUD = 1.58;
const DRUM_LAYERS: LayerName[] = ['kick', 'push', 'snare', 'hats', 'busy'];

/** One thing in Settings that can be switched between a few options, to try them in the game. */
export interface Choice {
  label: string;
  options: string[];
  get(): number;
  set(index: number): void;
}

interface Bar {
  /** The bass note. */
  root: number;
  /** The chord, as the three notes' places in the octave (0 is C). */
  chord: number[];
  /** The violin's tune: each note and how many sixteenths it lasts. */
  tune: [number, number][];
  /** The high shaking strings' one note. */
  high: number;
  /** The amber's line: a note for each eighth. Each half of the bar climbs. */
  bells: number[];
}
/** Eight bars in C sharp minor. */
const BARS: Bar[] = [
  { root: 37, chord: [1, 4, 8], tune: [[73, 4], [76, 4], [80, 6], [81, 2]], high: 80, bells: [85, 88, 92, 97, 88, 92, 97, 100] }, // C sharp minor
  { root: 33, chord: [9, 1, 4], tune: [[80, 4], [76, 4], [73, 8]], high: 88, bells: [85, 88, 93, 97, 88, 93, 97, 100] }, // A
  { root: 42, chord: [6, 9, 1], tune: [[78, 4], [81, 4], [85, 6], [84, 2]], high: 85, bells: [85, 90, 93, 97, 90, 93, 97, 99] }, // F sharp minor
  { root: 44, chord: [8, 0, 3], tune: [[80, 8], [84, 4], [80, 4]], high: 87, bells: [87, 92, 96, 99, 84, 87, 92, 96] }, // G sharp: the pull back home
  { root: 37, chord: [1, 4, 8], tune: [[73, 4], [76, 4], [80, 6], [81, 2]], high: 80, bells: [85, 88, 92, 97, 88, 92, 97, 100] },
  { root: 33, chord: [9, 1, 4], tune: [[81, 4], [80, 4], [76, 4], [73, 4]], high: 88, bells: [85, 88, 92, 97, 88, 93, 97, 100] }, // A (the bells keep the G sharp the violin passes through)
  { root: 38, chord: [2, 6, 9], tune: [[74, 4], [78, 4], [81, 6], [80, 2]], high: 81, bells: [81, 86, 90, 93, 86, 90, 93, 97] }, // D: the dark turn, and the bells drop with it
  { root: 44, chord: [8, 0, 3], tune: [[80, 4], [75, 4], [72, 8]], high: 87, bells: [87, 92, 96, 99, 84, 87, 92, 96] }, // G sharp
];
const barAt = (n: number) => BARS[((Math.floor(n / 16) % BARS.length) + BARS.length) % BARS.length];
const stepIn = (n: number) => ((n % 16) + 16) % 16;
/** The short string notes, a sixteenth each, in semitones above the octave over the bass: root, fifth and octave. */
const OSTINATO = [0, 0, 7, 0, 12, 0, 7, 0, 0, 0, 7, 0, 12, 7, 0, 7];
/** The sixteenths that are leaned on: three, three and two, twice over. */
const ACCENT = [0, 3, 6, 8, 11, 14];
/** Where in the bar each note of the tune starts. */
const TUNE_AT = BARS.map((bar) => {
  const at = new Map<number, [number, number]>();
  let s = 0;
  for (const note of bar.tune) {
    at.set(s, note);
    s += note[1];
  }
  return at;
});

/**
 * The parts that come and go, and the intensity each comes in at. Who is playing is decided at
 * the top of a bar, and for the tune and the high strings only at the top of a four-bar phrase;
 * and a part that is in stays in until the intensity is well under its mark. So nothing comes in
 * for two notes and leaves again, which the first build of this did at the start of every run.
 */
const MARKS = { cello: 0.22, snare: 0.3, tune: 0.38, hats: 0.4, push: 0.5, busy: 0.65, octave: 0.7, high: 0.75 };
type Part = keyof typeof MARKS;
const PARTS = Object.keys(MARKS) as Part[];
const ease01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The note `steps` notes of the bar's chord above (or below) `midi`. */
function chordStep(bar: Bar, midi: number, steps: number) {
  let m = midi;
  const dir = Math.sign(steps);
  for (let left = Math.abs(steps); left > 0; ) {
    m += dir;
    if (bar.chord.includes(((m % 12) + 12) % 12)) left--;
  }
  return m;
}
/** The first note of the bar's chord at or above `midi`. */
function chordFrom(bar: Bar, midi: number) {
  let m = midi;
  while (!bar.chord.includes(m % 12)) m++;
  return m;
}

type Mode = 'home' | 'quiet' | 'chase' | 'dash' | 'leap' | 'won' | 'lost';
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
  to?: AudioNode;
}
interface BowOpts {
  t: number;
  midi: number;
  attack: number;
  hold: number;
  release: number;
  cut: number;
  /** The filter starts this many times higher and closes down to `cut`. */
  open?: number;
  detune: number;
  vol: number;
  pan?: number;
  vibrato?: boolean;
  tremolo?: boolean;
  /** Die away this slowly: the release ends at this fraction of the note's volume, not at nothing. For a chord that should ring out. */
  ring?: number;
  to?: AudioNode;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  /** The music's own level, under the sounds of the run. */
  private music!: GainNode;
  /** The bowed notes all go in here. */
  private strings!: GainNode;
  /** And on their way there they pass through this, which can be swapped for a new one to let every held note go at once. */
  private bows!: GainNode;
  /** The chase's drums pass through this, for the same reason. */
  private kit!: GainNode;
  /** Which of the parts that come and go are playing now. */
  private playing: Partial<Record<Part, boolean>> | null = null;
  private reverb!: GainNode;
  private noise!: AudioBuffer;
  private wind!: GainNode;
  private pans = new Map<string, AudioNode>();
  /** A fuller string sound: more players to a part, bow noise, the body of the instruments, a hall. For listening tests. */
  private full = false;
  private silent: HTMLAudioElement | null = null;
  private timer = 0;
  private stale = false;
  private held = false;
  private muted = false;
  private mode: Mode = 'quiet';
  /** 0 far behind the egg, 1 right on it. */
  private close = 0;
  /** How much of the band is playing, 0 to 1: further down the trail and closer to the egg is more. */
  private level = 0.2;
  private levelAt = 0;
  /** The quiet held strings under everything (not in the clip of the original, which came before them). */
  bed = true;
  // the clock's grid
  private t0 = 0;
  private next = 0;
  /** When the egg's dash began, and when the next stroke of its drum roll is due. */
  private dashAt = 0;
  private rollNext = 0;
  /** The first sixteenth of the bar after the dash's, which the landing takes the place of. */
  private dashEnd = 0;
  // the ground's grid
  /** Where on the trail the music starts, and how many meters the chase runs for. */
  origin = 0;
  span = 600;
  private groundNext = -1;
  private lastS = 0;
  private lastV = 0;
  private amberStep = -1e9;
  private amberCount = 0;
  /** The riser before the leap and the chord held through it, kept so they can be cut off. */
  private rise: GainNode | null = null;
  private hold: GainNode | null = null;
  // ---- the recorded layers (layers.ts), which play in place of the synthesized band when they can
  private files: LayerFiles | null = null;
  private layers: Layers | null = null;
  /** The player's choice: the recorded band, or the synthesized one. */
  private wantRecorded = true;
  /**
   * The runner's cruising speed, in meters a second. The recorded layers are a performance at one
   * tempo, the one the level is laid out to at 8 meters a second; at any other speed the
   * synthesized band plays, which can play at any tempo.
   */
  pace = 8;
  /** Whether this bar is the recorded band's: decided at each bar line. */
  private taped = false;
  private tapeBus!: GainNode;
  /**
   * The layers all play as one tape. `posAt` seconds of the music are at the play head at the
   * context's time `timeAt`, and it runs at `rate`; `until` is how far the runner has let it play.
   */
  private tape = { rolling: false, timeAt: 0, posAt: 0, rate: 1, until: 0, lean: 0, voices: new Map<LayerName, { src: AudioBufferSourceNode; gain: GainNode; level: GainNode }>() };
  /** The build under the dash is the recorded one (so the synthesized drum roll keeps quiet). */
  private built = false;
  // ---- on trial (Drew, 2026-11-19): what the amber sounds like, how high, and how loud the recorded drums are
  private voice: Voice = 'xylophone';
  private amberLow = false;
  private drums = 0;

  /** `listen` is off for a copy that only draws the music to a file. */
  constructor(listen = true) {
    if (!listen) return;
    try {
      this.muted = localStorage.getItem('rr-sound1') === '0';
      this.wantRecorded = localStorage.getItem('rr-music1') !== 'synth';
      const voice = localStorage.getItem('rr-amber1') as Voice | null;
      if (voice && voice in VOICES) this.voice = voice;
      this.amberLow = localStorage.getItem('rr-amber-low1') === '1';
      this.drums = localStorage.getItem('rr-drums1') === '1' ? 1 : 0;
    } catch {
      /* private mode */
    }
    this.files = fetchLayers(`${import.meta.env.BASE_URL}music/chase/`);
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

  /** Which band plays the chase: the recorded strings and drums, or the synthesized ones. */
  get recorded() {
    return this.wantRecorded;
  }

  setRecorded(on: boolean) {
    this.wantRecorded = on;
    try {
      localStorage.setItem('rr-music1', on ? 'recorded' : 'synth');
    } catch {
      /* private mode */
    }
  }

  /**
   * The sounds on trial, for Settings and the pause sheet to offer. Picking one keeps it (on this
   * phone) and, for the amber's, plays a few notes of it.
   */
  choices(): Choice[] {
    const keep = (key: string, value: string) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* private mode */
      }
    };
    return [
      { label: 'Music', options: ['Recorded', 'Synth'], get: () => (this.wantRecorded ? 0 : 1), set: (i) => this.setRecorded(i === 0) },
      {
        label: 'Drums',
        options: ['Clear', 'Loud'],
        get: () => this.drums,
        set: (i) => {
          this.drums = i;
          keep('rr-drums1', String(i));
          const ctx = this.ctx;
          if (ctx) for (const name of DRUM_LAYERS) this.tape.voices.get(name)?.level.gain.setTargetAtTime(i ? DRUMS_LOUD : 1, ctx.currentTime, 0.05);
        },
      },
      {
        label: 'Amber',
        options: ['Bell', 'Xylophone', 'Marimba', 'Kalimba'],
        get: () => VOICE_NAMES.indexOf(this.voice),
        set: (i) => {
          this.voice = VOICE_NAMES[i] ?? 'bell';
          keep('rr-amber1', this.voice);
          this.sample();
        },
      },
      {
        label: 'Amber pitch',
        options: ['High', 'Low'],
        get: () => (this.amberLow ? 1 : 0),
        set: (i) => {
          this.amberLow = i === 1;
          keep('rr-amber-low1', i === 1 ? '1' : '0');
          this.sample();
        },
      },
    ];
  }

  /** For clips of the music: set the amber's voice and pitch, and the drum mix, without keeping them. */
  tryVoice(voice: Voice, low: boolean, drums = 0) {
    this.voice = voice;
    this.amberLow = low;
    this.drums = drums;
  }

  /** A few notes of the amber's voice, to hear a choice by: the first bar of its line. */
  private sample() {
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    BARS[0].bells.forEach((m, i) => this.chime(ctx, ctx.currentTime + 0.05 + i * 0.25, m));
  }

  /** For clips of the music (see preview.ts): have the recorded layers ready before drawing. */
  async loadRecorded(ctx: BaseAudioContext, folder = 'music/chase/') {
    this.layers = await fetchLayers(`${import.meta.env.BASE_URL}${folder}`).decode(ctx);
    if (this.layers) this.tapeBus.gain.value = this.layers.gain;
    return this.layers !== null;
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
      this.rise = this.hold = null;
      this.playing = null;
      this.timer = window.setInterval(() => this.schedule(), 30);
      // the recorded layers become sound the first time there is something to play them (they stay sound after that)
      void this.files?.decode(this.ctx).then((layers) => {
        this.layers = layers;
        if (layers && this.ctx) this.tapeBus.gain.value = layers.gain;
      });
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
  build(ctx: BaseAudioContext, full = false) {
    this.full = full;
    this.pans = new Map();
    this.rise = this.hold = null;
    // Everything goes through one limiter, so nothing can clip however much is playing. It is set
    // high: the kick is too low for a phone's speaker to play, and a limiter that leaned on it would
    // be heard as the rest of the music ducking for no reason.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -4;
    limit.knee.value = 4;
    limit.ratio.value = 12;
    limit.attack.value = 0.003;
    limit.release.value = 0.16;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.85;
    this.out.connect(limit).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = MUSIC;
    this.music.connect(this.out);
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
    this.strings = ctx.createGain();
    this.bows = ctx.createGain();
    this.bows.connect(this.strings);
    this.kit = ctx.createGain();
    this.kit.connect(this.music);
    this.playing = null;
    this.tapeBus = ctx.createGain();
    this.tapeBus.gain.value = this.layers?.gain ?? 1;
    this.tapeBus.connect(this.music);
    this.tape = { rolling: false, timeAt: 0, posAt: 0, rate: 1, until: 0, lean: 0, voices: new Map() };
    this.taped = this.built = false;
    if (!full) this.strings.connect(this.music);
    else {
      // the wooden body of the instruments: a few fixed resonances, and the very top rolled off
      let node: AudioNode = this.strings;
      for (const [f, q, gain] of [[280, 2.2, 4], [470, 2.6, 3], [1100, 1.4, -2.5], [2800, 1.3, 4.5]]) {
        const peak = ctx.createBiquadFilter();
        peak.type = 'peaking';
        peak.frequency.value = f;
        peak.Q.value = q;
        peak.gain.value = gain;
        node = node.connect(peak);
      }
      const top = ctx.createBiquadFilter();
      top.type = 'lowpass';
      top.frequency.value = 7000;
      node = node.connect(top);
      node.connect(this.music);
      // and the room they are playing in
      const room = ctx.createConvolver();
      room.buffer = hall;
      const wet = ctx.createGain();
      wet.gain.value = 0.2;
      node.connect(wet).connect(room).connect(this.music);
    }
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    // wind, very quiet, under everything: noise through a filter that drifts
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const dull = ctx.createBiquadFilter();
    dull.type = 'lowpass';
    dull.frequency.value = 380;
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.07;
    const sway = ctx.createGain();
    sway.gain.value = 120;
    drift.connect(sway).connect(dull.frequency);
    this.wind = ctx.createGain();
    this.wind.gain.value = 0.12; // (very quiet by the time the filter has taken most of it)
    air.connect(dull).connect(this.wind).connect(this.music);
    air.start();
    drift.start();
    return this;
  }

  /** Somewhere between the left ear and the right. Made once for each place and kept. */
  private panned(ctx: BaseAudioContext, amount: number, to: AudioNode) {
    if (!amount || !ctx.createStereoPanner) return to;
    const key = `${amount}${to === this.bows ? 'b' : to === this.kit ? 'k' : 'm'}`;
    let node = this.pans.get(key);
    if (!node) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = amount;
      pan.connect(to);
      this.pans.set(key, (node = pan));
    }
    return node;
  }

  /**
   * One bowed note: sawtooth waves a few cents apart through a filter. It swells in, holds until
   * `hold` seconds after it began, and dies away.
   */
  private bow(ctx: BaseAudioContext, o: BowOpts) {
    const to = o.to ?? this.panned(ctx, o.pan ?? 0, this.bows);
    if (!this.full) return this.bowed(ctx, o, [-o.detune, o.detune], 1, to);
    // more players, a few thousandths of a second apart, and the scrape of the bow as each note starts
    const late = o.hold < 0.2 ? 0.006 : 0.014;
    this.bowed(ctx, o, [-o.detune * 1.7, o.detune * 0.5], 0.72, to);
    this.bowed(ctx, { ...o, t: o.t + late }, [-o.detune * 0.6, o.detune * 1.6], 0.72, to);
    this.hiss(ctx, { t: o.t, len: o.hold < 0.2 ? 0.03 : 0.07, vol: o.vol * (o.hold < 0.2 ? 0.5 : 0.25), cut: Math.min(o.cut * 1.1, 3600), q: 0.9, attack: o.hold < 0.2 ? 0.004 : 0.02, to });
  }

  private bowed(ctx: BaseAudioContext, o: BowOpts, detunes: number[], scale: number, to: AudioNode) {
    const end = o.t + Math.max(o.hold, o.attack);
    const stop = end + o.release + (o.ring ? 0.25 : 0.03);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, o.t);
    amp.gain.linearRampToValueAtTime(o.vol * scale * BOWED, o.t + o.attack);
    amp.gain.setValueAtTime(o.vol * scale * BOWED, end);
    amp.gain.exponentialRampToValueAtTime(o.ring ? o.vol * scale * BOWED * o.ring : 0.0001, end + o.release);
    if (o.ring) amp.gain.linearRampToValueAtTime(0, end + o.release + 0.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    if (o.open) {
      filter.frequency.setValueAtTime(o.cut * o.open, o.t);
      filter.frequency.exponentialRampToValueAtTime(o.cut, o.t + 0.07);
    } else filter.frequency.value = o.cut;
    let wobble: GainNode | null = null;
    if (o.vibrato) {
      // the left hand's shake, coming in once the note has settled
      const lfo = ctx.createOscillator();
      lfo.frequency.value = this.full ? 5.2 + Math.random() * 0.7 : 5.5;
      wobble = ctx.createGain();
      wobble.gain.setValueAtTime(0, o.t);
      wobble.gain.setValueAtTime(0, o.t + 0.12);
      wobble.gain.linearRampToValueAtTime(9, o.t + (this.full ? 0.3 : 0.13));
      lfo.connect(wobble);
      lfo.start(o.t);
      lfo.stop(stop);
    }
    for (const detune of detunes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz(o.midi);
      osc.detune.value = detune;
      wobble?.connect(osc.detune);
      osc.connect(filter);
      osc.start(o.t);
      osc.stop(stop);
    }
    let tail: AudioNode = filter.connect(amp);
    if (o.tremolo) {
      // the bow shaking: fourteen times a second, between a fifth of the volume and all of it
      const shake = ctx.createGain();
      shake.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 14;
      const depth = ctx.createGain();
      depth.gain.value = 0.4;
      lfo.connect(depth).connect(shake.gain);
      lfo.start(o.t);
      lfo.stop(stop);
      tail = tail.connect(shake);
    }
    tail.connect(to);
  }

  /** One note: a wave through a filter, swelling in and dying away. The sounds of the run are made of these. */
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
    osc.start(o.t);
    osc.stop(o.t + o.len + release * 2 + 0.05);
  }

  private send(ctx: BaseAudioContext, from: AudioNode, to: AudioNode, amount: number) {
    const g = ctx.createGain();
    g.gain.value = amount;
    from.connect(g).connect(to);
  }

  /** A breath of noise through a filter that can sweep: drums, wind, skids and splashes are made of these. */
  private hiss(ctx: BaseAudioContext, o: { t: number; len: number; vol: number; cut: number; cutTo?: number; q?: number; type?: BiquadFilterType; attack?: number; rev?: number; to?: AudioNode }) {
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
    src.connect(filter).connect(amp).connect(o.to ?? this.out);
    if (o.rev) this.send(ctx, amp, this.reverb, o.rev);
    src.start(o.t, Math.random());
    src.stop(o.t + o.len + 0.05);
  }

  /** A struck or plucked tone that starts at once and dies away, its pitch falling as it goes: drums and bells. */
  private thump(ctx: BaseAudioContext, o: { t: number; from: number; to?: number; len: number; vol: number; wave?: OscillatorType; left?: number; out?: AudioNode }) {
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(o.from, o.t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.t + o.len);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, o.t);
    amp.gain.linearRampToValueAtTime(o.vol, o.t + 0.002);
    amp.gain.exponentialRampToValueAtTime(o.vol * (o.left ?? 0.006), o.t + o.len);
    amp.gain.linearRampToValueAtTime(0, o.t + o.len + 0.012);
    osc.connect(amp).connect(o.out ?? this.music);
    osc.start(o.t);
    osc.stop(o.t + o.len + 0.03);
  }

  private kick(ctx: BaseAudioContext, t: number) {
    this.thump(ctx, { t, from: 92, to: 42, len: 0.28, vol: 0.2, out: this.kit });
    this.hiss(ctx, { t, len: 0.03, vol: 0.1, cut: 300, q: 1, to: this.kit });
  }

  private snare(ctx: BaseAudioContext, t: number) {
    this.hiss(ctx, { t, len: 0.15, vol: 0.09, cut: 1900, q: 0.8, to: this.kit });
    this.thump(ctx, { t, from: 200, to: 150, len: 0.08, vol: 0.045, wave: 'triangle', out: this.kit });
  }

  private hat(ctx: BaseAudioContext, t: number, vol: number) {
    this.hiss(ctx, { t, len: 0.025, vol: vol * HATS, cut: 8000, type: 'highpass', to: this.panned(ctx, 0.2, this.kit) });
  }

  private tom(ctx: BaseAudioContext, t: number, from: number) {
    this.thump(ctx, { t, from, to: 90, len: 0.18, vol: 0.11, out: this.kit });
    this.hiss(ctx, { t, len: 0.012, vol: 0.03, cut: 900, q: 1, to: this.kit });
  }

  /** The amber's voice: a small bell, gone in a tenth of a second, with a brighter edge that goes sooner still. */
  private chime(ctx: BaseAudioContext, t: number, midi: number, vol = 0.11, ring = 0.11, pan = 0) {
    const out = this.panned(ctx, pan, this.music);
    const f = hz(midi - (this.amberLow ? 12 : 0));
    const voice = VOICES[this.voice];
    if (this.voice === 'bell') {
      this.thump(ctx, { t, from: f, len: ring, vol: vol * BELLS, out });
      this.thump(ctx, { t, from: f * 2.76, len: 0.05, vol: vol * BELLS * 0.3, out });
      return;
    }
    // A struck bar or tine. No two strikes are quite alike: a hair of pitch and of strength either way.
    const v = vol * BELLS * voice.level * (0.94 + 0.12 * Math.random());
    const bend = 1 + (Math.random() - 0.5) * 0.003;
    // (a caller that wants a long ring, like the hidden find's, gets a longer one, within what the thing could do)
    const longer = Math.min(1.8, Math.max(1, ring / 0.2));
    for (const [times, loud, len] of voice.tones) {
      if (f * times > 13000) continue;
      this.thump(ctx, { t, from: f * times * bend, len: len * (times === 1 ? longer : 1), vol: v * loud, out });
    }
    if (voice.knock) {
      const [cut, loud, len, type] = voice.knock;
      this.hiss(ctx, { t, len, vol: v * loud, cut, q: 0.9, type, attack: 0.001, to: out });
    }
  }

  // ---------------------------------------------------------------- the score
  /** Decide who is playing, from the intensity `k`, at the top of bar `index`. */
  private cast(index: number, k: number) {
    const first = !this.playing;
    const playing = (this.playing ??= {});
    for (const part of PARTS) {
      if (!first && (part === 'tune' || part === 'high') && index % 4 !== 0) continue;
      if (k > MARKS[part]) playing[part] = true;
      else if (k < MARKS[part] - 0.08) playing[part] = false;
    }
  }

  /**
   * What every part plays on one sixteenth. `k` is the intensity, 0 to 1. `dur` is how long a
   * sixteenth is lasting, for the notes that are held.
   */
  step(ctx: BaseAudioContext, n: number, t: number, k: number, dur = STEP) {
    const index = ((Math.floor(n / 16) % BARS.length) + BARS.length) % BARS.length;
    const bar = BARS[index];
    const at = stepIn(n);
    const long = dur / STEP;
    if (at === 0 || !this.playing) {
      this.cast(index, k);
      // (and which band plays this bar: the recorded one if it is here, wanted, and at its own tempo)
      const taped = this.layers !== null && this.wantRecorded && Math.abs(this.pace - 8) < 0.01;
      if (this.taped && !taped) this.tapeStop(ctx, t, 0.05);
      this.taped = taped;
    }
    if (this.taped) return this.tapeStep(ctx, n, t);
    const on = (part: Part) => this.playing?.[part] === true;
    // the short string notes, never stopping, leaned on in threes and twos
    this.bow(ctx, { t, midi: bar.root + 12 + OSTINATO[at], attack: 0.01, hold: 0.07, release: 0.04, cut: 1500 + 1200 * k, open: 1.8, detune: 7, vol: ACCENT.includes(at) ? 0.07 : 0.045, pan: at % 2 ? 0.15 : -0.15 });
    if (on('octave')) this.bow(ctx, { t, midi: bar.root + 24 + OSTINATO[at], attack: 0.01, hold: 0.06, release: 0.04, cut: 2600, detune: 7, vol: 0.03, pan: 0.3 });
    // the held strings under everything
    if (this.bed && at === 0) {
      this.bow(ctx, { t, midi: bar.root + 12, attack: 0.35, hold: 1.95 * long, release: 0.35, cut: 900 + 500 * k, detune: 10, vol: 0.035, pan: -0.2 });
      this.bow(ctx, { t, midi: bar.root + 19, attack: 0.35, hold: 1.95 * long, release: 0.35, cut: 900 + 500 * k, detune: 10, vol: 0.028, pan: 0.2 });
    }
    // cellos on beats one and three
    if (on('cello') && at % 8 === 0) this.bow(ctx, { t, midi: bar.root, attack: 0.04, hold: 0.9 * long, release: 0.12, cut: 520, detune: 6, vol: 0.075 });
    // the kit
    if (at % 8 === 0 || (on('push') && at === 10)) this.kick(ctx, t);
    if (on('snare') && at % 8 === 4) this.snare(ctx, t);
    if (on('hats') && (at % 2 === 0 || on('busy'))) this.hat(ctx, t, at % 4 === 2 ? 0.035 : 0.02);
    if (on('push') && index === BARS.length - 1 && at >= 12) this.tom(ctx, t, [180, 155, 130, 105][at - 12]);
    // the violin's tune
    const tune = TUNE_AT[index].get(at);
    if (on('tune') && tune) this.bow(ctx, { t, midi: tune[0], attack: 0.04, hold: tune[1] * dur * 0.97, release: 0.12, cut: 3200, detune: 6, vol: 0.05, pan: 0.12, vibrato: true });
    // and at the top of the chase, high strings shaking on one note a bar
    if (on('high') && at === 0) this.bow(ctx, { t, midi: bar.high, attack: 0.2, hold: 1.9 * long, release: 0.2, cut: 4000, detune: 7, vol: 0.025, pan: -0.3, tremolo: true });
  }

  // ---------------------------------------------------------------- the recorded band
  /**
   * The sixteenth `n` at time `t`, from the recorded layers. They are not played a sixteenth at a
   * time: they roll like a tape, and each sixteenth only checks that the tape is where the runner
   * is. While the runner keeps its pace nothing is touched, and the sound is the recording
   * exactly. If the tape has drifted a little it is leaned on, by too little to hear; if it is far
   * out, or was stopped, it is started again from this sixteenth. And it is only ever allowed to
   * play to the end of the sixteenth the runner has reached (`tapeWatch`), so a runner that
   * stumbles stops the music, and one getting back up to speed brings it back a note at a time,
   * as the synthesized band does.
   */
  private tapeStep(ctx: BaseAudioContext, n: number, t: number) {
    const tape = this.tape;
    const song = n * STEP;
    if (tape.rolling) {
      // how far ahead of the runner the tape is
      const ahead = tape.posAt + (t - tape.timeAt) * tape.rate - song;
      if (Math.abs(ahead) > 0.045) this.tapeStop(ctx, t, 0.02);
      else {
        tape.lean += (ahead - tape.lean) * 0.2;
        const rate = 1 - Math.max(-0.008, Math.min(0.008, tape.lean * 0.4));
        if (Math.abs(rate - tape.rate) > 0.0004) this.tapeLean(ctx, rate);
      }
    }
    if (!tape.rolling) Object.assign(tape, { rolling: true, timeAt: t, posAt: song, rate: 1, lean: 0 });
    tape.until = song + STEP;
    // who is playing: the same parts the synthesized band would have, a layer for each
    const on = (part: Part) => this.playing?.[part] === true;
    const want: Record<LayerName, boolean> = { base: true, kick: true, octave: on('octave'), cello: on('cello'), tune: on('tune'), high: on('high'), push: on('push'), snare: on('snare'), hats: on('hats'), busy: on('hats') && on('busy') };
    for (const name of LAYER_NAMES) {
      const voice = tape.voices.get(name);
      if (want[name] && !voice) this.tapeVoice(ctx, name, t);
      else if (!want[name] && voice) {
        this.tapeDrop(voice, t, 0.06);
        tape.voices.delete(name);
      }
    }
  }

  /** One layer joins the tape at time `t`, in step with the rest. */
  private tapeVoice(ctx: BaseAudioContext, name: LayerName, t: number) {
    const layers = this.layers;
    if (!layers) return;
    const tape = this.tape;
    const src = ctx.createBufferSource();
    src.buffer = layers.loops[name];
    src.loop = true;
    src.loopStart = layers.lead + layers.pad;
    src.loopEnd = src.loopStart + layers.length;
    src.playbackRate.value = tape.rate;
    // It comes in a little before `t` if there is time: a bowed note starts before its beat.
    const pre = Math.max(0, Math.min(0.06, t - ctx.currentTime - 0.003));
    const pos = tape.posAt + (t - tape.timeAt) * tape.rate;
    const into = ((pos % layers.length) + layers.length) % layers.length;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, Math.max(0, t - pre));
    gain.gain.linearRampToValueAtTime(1, Math.max(0, t - pre) + (pre > 0.02 ? 0.015 : 0.004));
    // (`level` is the drums' own knob, for the two drum mixes on trial)
    const level = ctx.createGain();
    level.gain.value = this.drums && DRUM_LAYERS.includes(name) ? DRUMS_LOUD : 1;
    src.connect(gain).connect(level).connect(this.tapeBus);
    src.start(Math.max(0, t - pre), Math.max(0, src.loopStart + into - pre * tape.rate));
    tape.voices.set(name, { src, gain, level });
  }

  /** One layer leaves from time `t`, over about `time` seconds. */
  private tapeDrop(voice: { src: AudioBufferSourceNode; gain: GainNode; level: GainNode }, t: number, time: number) {
    if (voice.gain.gain.cancelAndHoldAtTime) voice.gain.gain.cancelAndHoldAtTime(t);
    voice.gain.gain.setTargetAtTime(0, t, time / 3);
    voice.src.stop(t + time * 2 + 0.05);
  }

  /** Stop the tape from time `t`. */
  private tapeStop(ctx: BaseAudioContext, t: number, time: number) {
    const tape = this.tape;
    const at = Math.max(t, ctx.currentTime);
    for (const voice of tape.voices.values()) this.tapeDrop(voice, at, time);
    tape.voices.clear();
    tape.rolling = false;
  }

  /** Run the tape a touch faster or slower from now on: every layer at once, so they stay together. */
  private tapeLean(ctx: BaseAudioContext, rate: number) {
    const tape = this.tape;
    const at = ctx.currentTime + 0.005;
    if (at <= tape.timeAt) return;
    tape.posAt += (at - tape.timeAt) * tape.rate;
    tape.timeAt = at;
    tape.rate = rate;
    for (const voice of tape.voices.values()) voice.src.playbackRate.setValueAtTime(rate, at);
  }

  /** The tape may not play past what the runner has reached. Called every frame, and by the clock. */
  private tapeWatch(ctx: BaseAudioContext) {
    const tape = this.tape;
    if (!tape.rolling) return;
    const now = ctx.currentTime;
    if (tape.posAt + (now + 0.03 - tape.timeAt) * tape.rate <= tape.until) return;
    // (in the chase it stops as short as a bowed note does; at the end of the dash's bar it is let ring a little)
    const end = tape.timeAt + (tape.until - tape.posAt) / tape.rate;
    const time = this.mode === 'chase' ? 0.03 : 0.3;
    this.tapeStop(ctx, end - 0.02, time);
  }

  /** The music away from the chase, on the clock. */
  private free(ctx: BaseAudioContext, n: number, t: number) {
    // The egg's dash for the edge and the leap after it. The track plays on, exactly as it was,
    // to the end of its bar, kept in time by the clock so the slow motion cannot drag it. (The level
    // puts the dash on the last bar of the loop, the one that wants to go home, so the build is laid
    // over the track's own cadence and the catch lands where the loop would begin again. Twice
    // before this the track was cut off here to make way for the build, and Drew heard that as
    // the ending interrupting the music.)
    if (this.mode === 'dash' || this.mode === 'leap') {
      if (n < this.dashEnd) this.step(ctx, n, t, this.level);
      return;
    }
    // the nest: only the held strings, on the home chord, and the wind
    if (this.mode === 'quiet' && stepIn(n) === 0) {
      this.bow(ctx, { t, midi: 49, attack: 0.5, hold: 1.95, release: 0.5, cut: 800, detune: 10, vol: 0.03, pan: -0.2 });
      this.bow(ctx, { t, midi: 56, attack: 0.5, hold: 1.95, release: 0.5, cut: 800, detune: 10, vol: 0.024, pan: 0.2 });
    }
    // (once the egg is safe the landing rings out and there is nothing after it but the wind)
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
    this.tapeWatch(ctx);
    // the drum roll under the dash and the leap, for as long as they last (within reason)
    if ((this.mode === 'dash' || this.mode === 'leap') && this.hold && !this.built) {
      if (this.rollNext < ctx.currentTime) this.rollNext = ctx.currentTime + 0.005;
      while (this.rollNext < ctx.currentTime + 0.16 && this.rollNext - this.dashAt < 5) {
        this.stroke(ctx, this.rollNext, this.rollNext - this.dashAt);
        this.rollNext += 0.072;
      }
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
    const far = Math.min(1, Math.max(0, (s - this.origin) / this.span));
    // starting out, or after being put back somewhere else on the trail
    if (this.groundNext < 0 || this.groundNext < pos - 1 || this.groundNext > pos + 6) {
      if (this.groundNext >= 0) this.letGo(ctx, ctx.currentTime, 0.1);
      this.groundNext = Math.ceil(pos);
      this.level = 0.2 + 0.45 * far;
      this.playing = null;
    }
    // More of the band the further down the trail, and the closer the egg: eased over about a
    // second. The egg starts close by and then gets away, so being close only comes to count
    // over the first six bars: the music builds from the start, and does not start full and thin
    // out. Run cleanly and the tune comes in at the fifth bar, eight seconds in.
    const want = Math.min(0.95, 0.2 + 0.45 * far + 0.3 * this.close * ease01((s - this.origin) / 96));
    this.level += (want - this.level) * (1 - Math.exp(-Math.min(0.25, Math.max(0, ctx.currentTime - this.levelAt))));
    this.levelAt = ctx.currentTime;
    while (v > 0.8) {
      const wait = ((this.groundNext - pos) * METERS_PER_STEP) / v;
      if (wait > 0.14) break;
      this.step(ctx, this.groundNext, ctx.currentTime + Math.max(wait, 0.005), this.level, Math.min(0.3, METERS_PER_STEP / v));
      this.groundNext++;
    }
    this.tapeWatch(ctx);
  }

  // ---------------------------------------------------------------- what the game tells it
  /** Which music is playing: the quiet of the nest, the chase, the egg's dash for the edge, the leap, safe, or lost. */
  setMode(mode: Mode) {
    if (mode === this.mode) return;
    const ctx = this.ctx;
    if (ctx && mode === 'dash') {
      // the clock takes the music over from the ground, at the same place in the bar and without a join
      const pos = (this.lastS - this.origin) / METERS_PER_STEP;
      const n = this.groundNext < 0 ? Math.ceil(pos) : this.groundNext;
      const wait = this.lastV > 0.8 ? ((n - pos) * METERS_PER_STEP) / this.lastV : 0;
      this.t0 = ctx.currentTime + Math.min(0.2, Math.max(0.005, wait)) - n * STEP;
      this.next = n;
      this.dashEnd = (Math.floor(n / 16) + 1) * 16;
      this.startDash(ctx, ctx.currentTime + 0.01);
    }
    if (mode === 'quiet' || mode === 'chase' || mode === 'home') {
      // a fresh start: nothing left hanging from an ending
      if (ctx) {
        this.cut(this.rise, ctx.currentTime, 0.03);
        this.cut(this.hold, ctx.currentTime, 0.05);
        this.tapeStop(ctx, ctx.currentTime, 0.05);
      }
      this.rise = this.hold = null;
      this.playing = null;
      this.built = false;
    }
    this.mode = mode;
    this.groundNext = -1;
  }

  /** Bring something to silence from `t`, whatever it had been told to do after that. */
  private cut(node: GainNode | null, t: number, time: number) {
    if (!node) return;
    if (node.gain.cancelAndHoldAtTime) node.gain.cancelAndHoldAtTime(t);
    else node.gain.cancelScheduledValues(t);
    node.gain.setTargetAtTime(0, t, time);
  }

  /**
   * Let go of every bowed note still sounding, over `time` seconds, so nothing of the last chord
   * hangs over what comes next. With `drums`, the kit is stopped as well: a beat already on its
   * way must not fall after the music has landed.
   */
  private letGo(ctx: BaseAudioContext, t: number, time: number, drums = false) {
    this.tapeStop(ctx, t, time);
    this.bows.gain.setTargetAtTime(0, t, time);
    this.bows = ctx.createGain();
    this.bows.connect(this.strings);
    if (drums) {
      this.kit.gain.setTargetAtTime(0, t, 0.01);
      this.kit = ctx.createGain();
      this.kit.connect(this.music);
    }
    this.pans = new Map();
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
   * When the sixteenth `n` falls, for a bell. `t` is when the runner reaches it. But while the
   * recorded band is rolling, the bell goes with the music that is really playing: the tape may be
   * a few hundredths of a second off the runner (it is only leaned on, never jerked), and a bell
   * that far from the strings is heard as out of time, where one that far from the picture is not
   * seen at all. (Drew, build 64: bells and short strings "not at all" in time, mostly on the phone.)
   */
  private withTape(ctx: BaseAudioContext, n: number, t: number) {
    const tape = this.tape;
    if (!this.taped || !tape.rolling) return t;
    const now = ctx.currentTime;
    const when = tape.timeAt + (n * STEP - tape.posAt) / tape.rate;
    // (only if the two agree roughly: if not, the tape is about to be started again anyway)
    if (Math.abs(when - t) > 0.08) return t;
    return Math.max(when, now + 0.003);
  }

  /**
   * The fans are out, and a row of three pieces is swept in at once. They are not one chord but a
   * quick run of three inside the row's eighth note: the left piece is the written note, on the
   * beat, the middle one the next note up the chord, and the right one the note above that. So it
   * is still a note for each piece, and a line of rows is a cascade climbing through the chords.
   * (Drew, build 50: the three at once were "the most awkward-sounding notes", and the fan could be
   * "one of the coolest sections"; the triplets are his idea.)
   */
  private sweep(ctx: BaseAudioContext, n: number, t: number, third: number, eighth: number) {
    const bar = barAt(n);
    const written = chordFrom(bar, bar.bells[stepIn(n) >> 1]);
    // (a run that would go over the top of the bells' range is played an octave down, whole)
    const drop = chordStep(bar, written, 2) > 100 ? 12 : 0;
    const m = chordStep(bar, written, third) - drop;
    this.chime(ctx, t + (third * eighth) / 3, m, third ? 0.07 : 0.085, 0.16, (third - 1) * 0.4);
  }

  /**
   * A piece of amber, lying at `at` meters along the trail and `lift` meters up. It plays the
   * note written for that spot, on the grid: one short bell for one piece. Pieces hung in the
   * air over a jump play higher the higher they hang. With `third` (0, 1 or 2: left, middle or
   * right lane), it is one of a row swept in by the fans: see `sweep`.
   */
  amber(at?: number, lift = 0, third = -1) {
    const ctx = this.ctx;
    const g = this.onGrid();
    if (!ctx || !g) return;
    let [t, n] = g;
    if (third >= 0 && at !== undefined && this.mode === 'chase' && this.lastV > 0.8) {
      // (a swept piece arrives a little before the runner reaches its place: the note waits for the place)
      const pos = (this.lastS - this.origin) / METERS_PER_STEP;
      const slot = Math.round((at - this.origin) / METERS_PER_STEP / 2) * 2;
      const wait = Math.min(0.8, Math.max(0.004, ((slot - pos) * METERS_PER_STEP) / this.lastV));
      const rolling = this.taped && this.tape.rolling;
      return this.sweep(ctx, slot, this.withTape(ctx, slot, ctx.currentTime + wait), third, rolling ? (2 * STEP) / this.tape.rate : (2 * METERS_PER_STEP) / this.lastV);
    }
    if (at !== undefined && this.mode === 'chase' && this.lastV > 0.8) {
      // its own place on the grid, which the runner is just reaching
      const pos = (this.lastS - this.origin) / METERS_PER_STEP;
      n = Math.round((at - this.origin) / METERS_PER_STEP);
      t = this.withTape(ctx, n, ctx.currentTime + Math.min(0.2, Math.max(0.004, ((n - pos) * METERS_PER_STEP) / this.lastV)));
    }
    const bar = barAt(n);
    const same = n === this.amberStep;
    this.amberStep = n;
    this.amberCount = same ? this.amberCount + 1 : 0;
    if (this.amberCount > 2) return;
    let m = bar.bells[stepIn(n) >> 1];
    if (lift > 0.5) m = chordStep(bar, chordFrom(bar, m), lift > 0.85 ? 2 : 1);
    if (this.amberCount) m = chordStep(bar, chordFrom(bar, m), -this.amberCount);
    while (m > 100) m = chordStep(bar, m, -1);
    this.chime(ctx, t, m, this.amberCount ? 0.07 : 0.11);
  }

  /**
   * For clips of the music (see preview.ts): the amber's bell for the sixteenth `n`, at time `t`.
   * With `run`, the earlier version's way, which Drew's clip of it has: that many notes up the
   * chord, the first two pieces of a run on the same note. (The game plays the written line.)
   */
  ring(ctx: BaseAudioContext, n: number, t: number, run = -1, third = -1) {
    if (third >= 0) return this.sweep(ctx, n, t, third, 2 * STEP);
    const bar = barAt(n);
    let m = run < 0 ? bar.bells[stepIn(n) >> 1] : chordStep(bar, chordFrom(bar, 76), Math.max(0, run - 1));
    while (m > 100) m = chordStep(bar, m, -1);
    this.chime(ctx, t, m);
  }

  /** For clips of the music: how loud the music is, and everything together. */
  mix(music: number, all: number) {
    this.music.gain.value = music;
    this.out.gain.value = all;
  }

  /**
   * A tap on a menu: the amber's bell, in the music's key. `go` is the button that starts a run,
   * `back` one that closes something, `tap` any other. (The home screen has only these and the
   * wind until the game has a theme of its own.)
   */
  menu(kind: 'tap' | 'go' | 'back' = 'tap', up = 0) {
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.03;
    // (`up` lifts a tap a step or two up the home chord: three taps in a row can climb)
    const notes = kind === 'go' ? [85, 88, 92, 97] : kind === 'back' ? [85] : [[88, 92, 97, 100][Math.min(3, Math.max(0, up))]];
    notes.forEach((m, i) => this.chime(ctx, t + i * 0.07, m, 0.11, kind === 'go' ? 0.3 : 0.2));
  }

  /** A hidden find: three bells up the chord, ringing on. */
  find() {
    const g = this.onGrid();
    if (!g || !this.ctx) return;
    const bar = barAt(g[1]);
    const from = chordFrom(bar, 85);
    for (let i = 0; i < 3; i++) this.chime(this.ctx, g[0] + i * STEP, chordStep(bar, from, i * 2), 0.12, 0.9);
  }

  /** The golden leaf: a quick run up the chord. */
  leaf() {
    const g = this.onGrid();
    if (!g || !this.ctx) return;
    const bar = barAt(g[1]);
    const from = chordFrom(bar, 80);
    for (let i = 0; i < 6; i++) this.chime(this.ctx, g[0] + i * STEP * 0.5, chordStep(bar, from, i), 0.1, 0.3);
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
    // (the recorded band stops with the runner, there and then: left to itself it would play out the sixteenth it had been promised)
    if (this.tape.rolling && this.mode === 'chase') this.tapeStop(c[0], c[1], 0.09);
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

  /** Air rushing upward and one note sliding up an octave. */
  private riser(ctx: BaseAudioContext, t: number) {
    const len = 1.6;
    const rise = ctx.createGain();
    rise.connect(this.music);
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const pass = ctx.createBiquadFilter();
    pass.type = 'highpass';
    pass.frequency.setValueAtTime(2500, t);
    pass.frequency.exponentialRampToValueAtTime(7000, t + len);
    const swell = ctx.createGain();
    swell.gain.setValueAtTime(0, t);
    swell.gain.linearRampToValueAtTime(0.07, t + len);
    air.connect(pass).connect(swell).connect(rise);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(hz(61), t);
    saw.frequency.exponentialRampToValueAtTime(hz(73), t + len);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 2400;
    const up = ctx.createGain();
    up.gain.setValueAtTime(0, t);
    up.gain.linearRampToValueAtTime(0.05, t + len);
    saw.connect(low).connect(up).connect(rise);
    // If nobody leaps or misses it does not hang on for ever. (This fade is on the two parts, not
    // on `rise`: the first build put it on `rise`, where it undid the cut at the landing, and the
    // riser came back as a stray note a second after the music had landed.)
    for (const g of [swell, up]) {
      g.gain.setValueAtTime(g === swell ? 0.07 : 0.05, t + len + 1.5);
      g.gain.linearRampToValueAtTime(0, t + len + 2.5);
    }
    air.start(t);
    saw.start(t);
    air.stop(t + len + 2.6);
    saw.stop(t + len + 2.6);
    this.rise = rise;
  }

  /**
   * The egg goes for the edge at `t`. The track plays on; over it come air rushing upward, the
   * chord of the bar swelling under shaking strings, and a drum roll that grows.
   */
  private startDash(ctx: BaseAudioContext, t: number) {
    this.riser(ctx, t);
    const hold = ctx.createGain();
    hold.gain.setValueAtTime(1, t);
    hold.connect(this.music);
    this.hold = hold;
    const layers = this.taped ? this.layers : null;
    this.built = layers !== null;
    if (layers) {
      // the recorded build: the same chord swelling, and its own drum roll
      const src = ctx.createBufferSource();
      src.buffer = layers.build;
      const level = ctx.createGain();
      level.gain.value = layers.gain;
      src.connect(level).connect(hold);
      src.start(t, layers.lead);
    } else {
      // G sharp major, low to high, the top three shaking
      for (const [midi, vol, cut] of [[44, 0.06, 600], [56, 0.05, 1200], [60, 0.04, 2400], [63, 0.04, 2800], [68, 0.035, 3200]]) {
        this.bow(ctx, { t, midi, attack: 1.6, hold: 8, release: 0.4, cut, detune: 7, vol, tremolo: midi >= 60, to: hold });
      }
    }
    this.dashAt = this.rollNext = t;
  }

  /** One stroke of the drum roll, louder the longer the roll has gone on. */
  private stroke(ctx: BaseAudioContext, t: number, since: number) {
    if (this.built) return;
    const vol = 0.03 + 0.13 * Math.min(1, since / 2);
    const out = this.hold ?? this.music;
    this.thump(ctx, { t, from: 108, to: 100, len: 0.2, vol, left: 0.02, out });
    // (the skin of the drum: the part of it a phone's speaker can play)
    this.hiss(ctx, { t, len: 0.05, vol: vol * 0.45, cut: 480, q: 0.8, to: out });
  }

  /** The leap at `t`, landing `dur` seconds later: a low hit, and everything that was swelling swells faster. */
  private leapAt(ctx: BaseAudioContext, t: number, dur: number) {
    this.thump(ctx, { t, from: 110, to: 40, len: 0.8, vol: 0.24 });
    this.hiss(ctx, { t, len: 0.14, vol: 0.09, cut: 420, q: 0.7, to: this.music });
    if (this.hold) {
      this.hold.gain.setValueAtTime(1, t);
      this.hold.gain.linearRampToValueAtTime(1.5, t + Math.max(0.2, dur));
    }
  }

  /**
   * The landing at `t`: everything that was building stops dead, and the music lands at home in
   * the major and rings out. `home` puts the home note on top in place of the bright third.
   */
  private landAt(ctx: BaseAudioContext, t: number, home = false) {
    this.cut(this.rise, t, 0.02);
    this.cut(this.hold, t, 0.04);
    this.rise = this.hold = null;
    this.letGo(ctx, t, 0.04, true);
    const layers = this.taped && !home ? this.layers : null;
    this.built = false;
    if (layers) {
      // the recorded landing: the same chord, a drum and a cymbal under it, ringing out
      const src = ctx.createBufferSource();
      src.buffer = layers.landing;
      const level = ctx.createGain();
      level.gain.value = layers.gain;
      src.connect(level).connect(this.music);
      src.start(t, layers.lead);
      return;
    }
    // a big drum, a timpani on the home note, a wash of cymbal, and a knock a small speaker can play
    // (the two drums are kept modest: a phone cannot play them, and at full weight they only use up room the chord needs)
    this.thump(ctx, { t, from: 92, to: 36, len: 1.6, vol: 0.2 });
    this.thump(ctx, { t, from: 70.5, to: 68.5, len: 2.2, vol: 0.11, left: 0.01 });
    this.hiss(ctx, { t, len: 1.8, vol: 0.05, cut: 6500, type: 'highpass', attack: 0.01, to: this.music });
    this.hiss(ctx, { t, len: 0.22, vol: 0.17, cut: 380, q: 0.6, to: this.music });
    // C sharp major from the bottom of the cellos to the top of the violins, brighter the higher
    // it goes, the home notes strongest and the third on top the softest
    // (loud enough to top the build before it, now that the whole track plays through that)
    const chord = [[37, 0.082], [49, 0.089], [56, 0.065], [61, 0.089], [65, 0.056], [68, 0.056], [73, 0.073], [77, 0.036]];
    if (home) chord.pop();
    chord.forEach(([midi, vol], i) => {
      const up = i / 7;
      this.bow(ctx, { t, midi, attack: 0.03, hold: 1.6, release: 3.2, cut: 500 + 3100 * up, detune: 7, vol, pan: (i % 2 ? 1 : -1) * 0.25 * up, vibrato: midi >= 61, ring: 0.012 });
    });
  }

  /** For clips of the music (see preview.ts): the whole ending from the sixteenth `n` at time `t`, with a dash and a dive of these lengths. */
  finale(ctx: BaseAudioContext, n: number, t: number, dash: number, dive: number, home = false) {
    this.startDash(ctx, t);
    const land = t + dash + dive;
    for (let i = 0; t + i * STEP < land - 0.01; i++) this.step(ctx, n + i, t + i * STEP, 0.95);
    for (let at = t; at < land - 0.01; at += 0.072) this.stroke(ctx, at, at - t);
    this.leapAt(ctx, t + dash, dive);
    this.landAt(ctx, land, home);
  }

  /** The leap for the egg, which will land in `dur` seconds. */
  leap(dur: number) {
    const c = this.now();
    this.setMode('leap');
    if (c) this.leapAt(c[0], c[1], dur);
  }

  /** The catch. */
  caught() {
    const c = this.now();
    this.setMode('won');
    if (c) this.landAt(c[0], c[1]);
    else this.rise = this.hold = null;
  }

  /** Too late, or lost on the way down: whatever was building lets go, and the music falls away. */
  lost() {
    const c = this.now();
    if (this.ctx) {
      this.cut(this.rise, this.ctx.currentTime, 0.15);
      this.cut(this.hold, this.ctx.currentTime, 0.3);
    }
    this.rise = this.hold = null;
    this.setMode('lost');
    if (!c) return;
    const [ctx, t] = c;
    this.letGo(ctx, t, 0.25);
    this.note(ctx, { t, f: hz(61), bend: hz(49), wave: 'triangle', len: 1.3, vol: 0.14, attack: 0.05, release: 0.6, rev: 0.7 });
    // the home note with the wrong notes over it, low and dark, and nothing after
    for (const midi of [49, 52, 55]) this.bow(ctx, { t: t + 0.2, midi, attack: 0.3, hold: 2.0, release: 1.2, cut: 900, detune: 9, vol: 0.035 });
  }
}
