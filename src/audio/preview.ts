// A listening tool, not part of the game. It draws clips of the music to sound files, faster
// than they play, so they can be measured against the original and listened to away from the
// game. Nothing in the game loads this file. On the dev server, from the browser's console:
//
//   const tool = await import('/src/audio/preview.ts');
//   await tool.send('match');   // posts match.wav to a small receiver on port 8787
//
// The clips:
//   match  the 34 seconds of the original's preview: 16 s quiet (0.25), 18 s full (0.9), and
//          two runs of amber climbing the chord, as the original's amber did
//   full   the same, with the fuller string sound
//   bells  the amber's own written line: the eight bars with every bell, then the eight bars
//          again with lines and gaps as a level might lay them
//   game   sixteen seconds as the game mixes it, limiter and all, to check the levels
//   ending       two bars of the chase at full strength, then the egg's dash (1.4 s), the dive
//                (0.56 s) and the landing, ringing out
//   ending-home  the same, landing with the home note on top
//   fan    bars 29 to 33 of the level: a line of amber, then the fans out over three lanes for
//          two and a half bars (each row a run of three bells), then a line again
//
// And `blend` (posted with `sendBlend`): the synthesized band's driving short notes under the
// recorded layers, at any level, to hear how much of the synth's edge the recorded strings want.

import { Sound } from './sound';
import type { LayerName } from './layers';

const RATE = 44100;
const STEP = 0.125;
export type Clip = 'match' | 'full' | 'bells' | 'game' | 'ending' | 'ending-home' | 'fan';

/** Lines and gaps for the second half of the bells clip: one string of eight eighths for each bar. */
const LINES = ['11110000', '00111111', '11111111', '00001111', '11110011', '11111111', '00111100', '11110000'];

/** The parts of the band, for hearing or measuring one alone. */
export const PARTS = ['wind', 'kick', 'snare', 'hat', 'tom', 'cello', 'spic', 'octave', 'violin', 'trem', 'bells'];

/** Silence every part but one. (It reaches into the band's private parts, which only a tool like this should.) */
function solo(band: Sound, part: string) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const b = band as any;
  const bow = b.bow.bind(b);
  const which = (o: any) => (o.tremolo ? 'trem' : o.vibrato ? 'violin' : o.open ? 'spic' : o.cut === 520 ? 'cello' : o.cut === 2600 ? 'octave' : 'bed');
  b.bow = (ctx: BaseAudioContext, o: any) => {
    if (which(o) === part) bow(ctx, o);
  };
  for (const drum of ['kick', 'snare', 'hat', 'tom']) if (drum !== part) b[drum] = () => undefined;
  if (part !== 'bells') b.chime = () => undefined;
  if (part !== 'wind') b.wind.gain.value = 0;
}

export async function clip(kind: Clip, only?: string, recorded = false): Promise<Float32Array[]> {
  const ending = kind === 'ending' || kind === 'ending-home';
  const seconds = kind === 'game' ? 16 : ending || kind === 'fan' ? 12 : 34;
  const ctx = new OfflineAudioContext(2, seconds * RATE, RATE);
  const band = new Sound(false);
  band.build(ctx, kind === 'full');
  // (`recorded`: the layers from Ableton in place of the synthesized band)
  if (recorded) await band.loadRecorded(ctx);
  if (only) solo(band, only);
  band.bed = kind === 'bells' || kind === 'game' || ending || kind === 'fan';
  // (quiet enough that the limiter never touches it: the clip is brought up to level afterwards)
  if (kind !== 'game') band.mix(0.5, 1);
  if (ending) {
    // (bars six and seven, so the dash comes in off the D chord: the hardest place to land from)
    for (let n = 80; n < 112; n++) band.step(ctx, n, (n - 80) * STEP, 0.95);
    band.finale(ctx, 112, 4, 1.4, 0.56, kind === 'ending-home');
  }
  if (kind === 'fan') {
    // (as the level lays them: the fork's last line on bar 29, three lanes from the third beat of bar 30 to the end of bar 32, and the first line of bar 33)
    for (let n = 448; n < 528; n++) band.step(ctx, n, (n - 448) * STEP, 0.8);
    const when = (n: number) => (n - 448) * STEP;
    for (let n = 452; n <= 462; n += 2) band.ring(ctx, n, when(n));
    for (let n = 472; n <= 510; n += 2) for (let third = 0; third < 3; third++) band.ring(ctx, n, when(n), -1, third);
    for (let n = 516; n <= 522; n += 2) band.ring(ctx, n, when(n));
  }
  const steps = ending || kind === 'fan' ? 0 : kind === 'bells' ? 256 : seconds / STEP;
  for (let n = 0; n < steps; n++) {
    const t = n * STEP;
    const k = kind === 'match' || kind === 'full' ? (n < 128 ? 0.25 : 0.9) : 0.6;
    band.step(ctx, n, t, k);
    if (kind === 'bells' && n % 2 === 0 && (n < 128 || LINES[(n >> 4) % 8][(n % 16) >> 1] === '1')) band.ring(ctx, n, t);
  }
  if (kind === 'match' || kind === 'full') {
    for (const [from, count] of [[4, 11], [20, 13]]) for (let i = 0; i < count; i++) band.ring(ctx, (from + i * 0.25) / STEP, from + i * 0.25, i);
  }
  const out = await ctx.startRendering();
  return [out.getChannelData(0), out.getChannelData(1)];
}

/**
 * The synthesized band's short notes (and the octave over them) played under the recorded layers.
 * Drew, after build 67: "what's really missing compared to the synth version is that driving,
 * crunchy synth that's going up and down arpeggios the whole time". Eighteen seconds at 48 kHz as
 * the game mixes it, limiter and all, with the drums as Drew picked them (Loud) and the amber as lines and gaps. Bars 1
 * to 4 are at the early run's intensity and bars 5 to 8 at full, where the octave joins; then the
 * first beat of bar 1 again, ringing out.
 *   pulse  the synthesized notes at this many times their level in the synthesized band (0: none)
 *   music  everything before the limiter turned by this, to bring each blend to the same loudness
 *   tape   the recorded layers turned by this (0 leaves them out, to measure the pulse alone)
 *   only   only these recorded layers
 *   bells  the amber (on unless false)
 *   synth  the synthesized band alone, all of it, for comparison (`pulse`, `tape` and `only` are left out)
 * The pulse is the game's own code: the band's `step` runs a second time on each sixteenth with
 * the tape left alone, and everything it plays but those two parts is dropped.
 */
export async function blend(o: { pulse?: number; music?: number; tape?: number; only?: LayerName[]; bells?: boolean; synth?: boolean } = {}): Promise<Float32Array[]> {
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, 18 * rate, rate);
  const band = new Sound(false);
  band.build(ctx);
  if (!o.synth) await band.loadRecorded(ctx);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const b = band as any;
  b.music.gain.value *= o.music ?? 1;
  const steps = 132;
  const k = (n: number) => (n < 64 ? 0.45 : 0.9);
  const bells = (n: number) => o.bells !== false && n % 2 === 0 && LINES[(n >> 4) % 8][(n % 16) >> 1] === '1' && band.ring(ctx, n, n * STEP);
  if (o.synth) {
    for (let n = 0; n < steps; n++) {
      band.step(ctx, n, n * STEP, k(n));
      bells(n);
    }
    const out = await ctx.startRendering();
    return [out.getChannelData(0), out.getChannelData(1)];
  }
  b.tapeBus.gain.value *= o.tape ?? 1;
  b.bows.gain.value = o.pulse ?? 0;
  // (the short notes are the bowed notes whose filter opens, `open`; the octave's filter is at 2600)
  const bow = b.bow.bind(b);
  b.bow = (c: BaseAudioContext, n: any) => (n.open || n.cut === 2600 ? bow(c, n) : undefined);
  for (const drum of ['kick', 'snare', 'hat', 'tom']) b[drum] = () => undefined;
  if (o.only) {
    const voice = b.tapeVoice.bind(b);
    b.tapeVoice = (c: BaseAudioContext, name: LayerName, t: number) => (o.only?.includes(name) ? voice(c, name, t) : undefined);
  }
  const layers = b.layers;
  const stop = b.tapeStop;
  for (let n = 0; n < steps; n++) {
    const t = n * STEP;
    band.step(ctx, n, t, k(n));
    // the synthesized band's turn: with no layers it plays itself, and the tape is not stopped for it
    Object.assign(b, { layers: null, tapeStop: () => undefined, taped: false });
    band.step(ctx, n, t, k(n));
    Object.assign(b, { layers, tapeStop: stop, taped: true });
    bells(n);
  }
  b.tapeStop(ctx, steps * STEP, 1.5);
  const out = await ctx.startRendering();
  return [out.getChannelData(0), out.getChannelData(1)];
}

/** Draw a blend (see `blend`) and post it to the receiver as `<name>.wav`. Says its peak. */
export async function sendBlend(name: string, o: Parameters<typeof blend>[0] = {}, to = 'http://localhost:8787') {
  const channels = await blend(o);
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const reply = await fetch(`${to}/${name}.wav`, { method: 'POST', body: wav(channels, 48000) });
  return `${name}: peak ${(20 * Math.log10(peak)).toFixed(2)} dB, receiver said ${reply.status}`;
}

function wav(channels: Float32Array[], rate = RATE) {
  const frames = channels[0].length;
  const bytes = new DataView(new ArrayBuffer(44 + frames * 4));
  const put = (at: number, text: string) => [...text].forEach((ch, i) => bytes.setUint8(at + i, ch.charCodeAt(0)));
  put(0, 'RIFF');
  bytes.setUint32(4, 36 + frames * 4, true);
  put(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 2, true);
  bytes.setUint32(24, rate, true);
  bytes.setUint32(28, rate * 4, true);
  bytes.setUint16(32, 4, true);
  bytes.setUint16(34, 16, true);
  put(36, 'data');
  bytes.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) for (let ch = 0; ch < 2; ch++) bytes.setInt16(44 + i * 4 + ch * 2, Math.round(Math.max(-1, Math.min(1, channels[ch][i])) * 32767), true);
  return new Blob([bytes], { type: 'audio/wav' });
}

/** Draw a clip and post it to the receiver. Says how loud it came out. */
export async function send(kind: Clip, only?: string, to = 'http://localhost:8787', recorded = false) {
  const channels = await clip(kind, only, recorded);
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i += 7) peak = Math.max(peak, Math.abs(ch[i]));
  const reply = await fetch(`${to}/${kind}${only ? `-${only}` : ''}${recorded ? '-recorded' : ''}.wav`, { method: 'POST', body: wav(channels) });
  return `${kind}: peak ${peak.toFixed(3)}, receiver said ${reply.status}`;
}
