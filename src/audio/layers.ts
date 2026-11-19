// The chase music as recorded layers: the same notes the band in sound.ts plays, performed by
// sampled strings and drums in Ableton Live (music/ableton) and exported one layer to a file
// (music/ableton/cut_layers.py makes the files in public/music/chase from Live's export).
//
// A loop layer is the eight bars, sixteen seconds at 120 beats a minute, with a little of the
// loop's own end before it and of its own start after it, so a player can come in just before a
// bar line and can loop without a join. The build is the swell and the drum roll under the
// egg's dash, eight seconds of it, and the landing is the chord the catch lands on, ringing out.
//
// The files are fetched as soon as the game starts and decoded when sound is first allowed.
// Until they are ready, or if they never arrive, the game plays the synthesized band.

export const LAYER_NAMES = ['base', 'kick', 'octave', 'cello', 'tune', 'high', 'push', 'snare', 'hats', 'busy'] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

export interface Layers {
  /** How much to turn the files up or down to sit where the synthesized band sat. */
  gain: number;
  /** Seconds of the loop, and seconds of its own music before its first bar and after its last. */
  length: number;
  pad: number;
  /** Seconds to skip at the start of every file: see `decode`. */
  lead: number;
  loops: Record<LayerName, AudioBuffer>;
  build: AudioBuffer;
  landing: AudioBuffer;
}

interface Sheet {
  gain: number;
  length: number;
  pad: number;
}

export interface LayerFiles {
  /** The layers as sound, once every file is in. Null if any of them could not be had. */
  decode(ctx: BaseAudioContext): Promise<Layers | null>;
}

/** Start fetching the files. Nothing is decoded until `decode` is called. */
export function fetchLayers(base: string): LayerFiles {
  const get = async (name: string) => {
    const reply = await fetch(`${base}${name}`);
    if (!reply.ok) throw new Error(`${name}: ${reply.status}`);
    return reply;
  };
  const names = [...LAYER_NAMES, 'build', 'landing'];
  const files = Promise.all([get('layers.json').then((r) => r.json() as Promise<Sheet>), ...names.map((n) => get(`${n}.m4a`).then((r) => r.arrayBuffer()))]).catch(() => null);
  let decoded: Promise<Layers | null> | null = null;
  return {
    decode(ctx) {
      decoded ??= (async () => {
        const got = await files;
        if (!got) return null;
        const [sheet, ...data] = got as [Sheet, ...ArrayBuffer[]];
        try {
          // (the old callback form too: some iPhones only have that one)
          const buffers = await Promise.all(data.map((d) => new Promise<AudioBuffer>((resolve, reject) => void ctx.decodeAudioData(d.slice(0), resolve, reject)?.catch?.(reject))));
          // A file like these begins with a twentieth of a second the encoder adds, which a decoder is
          // meant to take off again. One that leaves it on gives a longer sound: skip it then.
          const extra = buffers[0].duration - (sheet.length + 2 * sheet.pad);
          const lead = extra > 0.03 ? 2112 / 44100 : 0;
          const loops = Object.fromEntries(LAYER_NAMES.map((name, i) => [name, buffers[i]])) as Record<LayerName, AudioBuffer>;
          return { gain: sheet.gain, length: sheet.length, pad: sheet.pad, lead, loops, build: buffers[LAYER_NAMES.length], landing: buffers[LAYER_NAMES.length + 1] };
        } catch {
          return null;
        }
      })();
      return decoded;
    },
  };
}
