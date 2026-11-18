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

import { Sound } from './sound';

const RATE = 44100;
const STEP = 0.125;
export type Clip = 'match' | 'full' | 'bells' | 'game';

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

export async function clip(kind: Clip, only?: string): Promise<Float32Array[]> {
  const seconds = kind === 'game' ? 16 : 34;
  const ctx = new OfflineAudioContext(2, seconds * RATE, RATE);
  const band = new Sound(false);
  band.build(ctx, kind === 'full');
  if (only) solo(band, only);
  band.bed = kind === 'bells' || kind === 'game';
  // (quiet enough that the limiter never touches it: the clip is brought up to level afterwards)
  if (kind !== 'game') band.mix(0.5, 1);
  const steps = kind === 'bells' ? 256 : seconds / STEP;
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

function wav(channels: Float32Array[]) {
  const frames = channels[0].length;
  const bytes = new DataView(new ArrayBuffer(44 + frames * 4));
  const put = (at: number, text: string) => [...text].forEach((ch, i) => bytes.setUint8(at + i, ch.charCodeAt(0)));
  put(0, 'RIFF');
  bytes.setUint32(4, 36 + frames * 4, true);
  put(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 2, true);
  bytes.setUint32(24, RATE, true);
  bytes.setUint32(28, RATE * 4, true);
  bytes.setUint16(32, 4, true);
  bytes.setUint16(34, 16, true);
  put(36, 'data');
  bytes.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) for (let ch = 0; ch < 2; ch++) bytes.setInt16(44 + i * 4 + ch * 2, Math.round(Math.max(-1, Math.min(1, channels[ch][i])) * 32767), true);
  return new Blob([bytes], { type: 'audio/wav' });
}

/** Draw a clip and post it to the receiver. Says how loud it came out. */
export async function send(kind: Clip, only?: string, to = 'http://localhost:8787') {
  const channels = await clip(kind, only);
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i += 7) peak = Math.max(peak, Math.abs(ch[i]));
  const reply = await fetch(`${to}/${kind}${only ? `-${only}` : ''}.wav`, { method: 'POST', body: wav(channels) });
  return `${kind}: peak ${peak.toFixed(3)}, receiver said ${reply.status}`;
}
