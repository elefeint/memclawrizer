/**
 * WebAudio-synthesized game sounds — no asset files (settled decision).
 * The context is created lazily on the first sound, which always follows a
 * user gesture (clicking Drill / pressing Enter), so autoplay policy is happy.
 *
 * The defaults are intentionally intrusive: the stress is the feature.
 */

/** Master volume 0..1. Deliberately loud; a settings slider can scale it later. */
export const MASTER_VOLUME = 0.8;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function graph(): { c: AudioContext; out: GainNode } {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { c: ctx, out: master as GainNode };
}

function blip(
  freq: number,
  type: OscillatorType,
  gain: number,
  attackS: number,
  decayS: number,
  startAt = 0,
  freqEnd?: number,
): void {
  const { c, out } = graph();
  const t0 = c.currentTime + startAt;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + decayS);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attackS);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attackS + decayS);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + attackS + decayS + 0.05);
}

/**
 * Kitchen-timer tick: a dry mechanical click. rate >= 1; higher rates (the
 * final 25% of the countdown) pitch the click up so the acceleration is felt
 * in timbre as well as cadence.
 */
export function playTick(rate: number): void {
  const f = 1500 + 600 * Math.min(rate - 1, 3);
  blip(f, 'square', 0.16, 0.001, 0.045);
  blip(f / 3, 'triangle', 0.1, 0.001, 0.03); // wooden body under the click
}

/** Loud timeout ding — an unmissable bell. */
export function playDing(): void {
  blip(1175, 'sine', 0.85, 0.002, 1.1);
  blip(1175 * 1.5, 'sine', 0.4, 0.002, 0.7);
  blip(1175 * 2.76, 'sine', 0.22, 0.002, 0.35); // inharmonic partial = metallic
}

/** Short success chirp — bright, quick, out of the way. */
export function playSuccessChirp(): void {
  blip(720, 'sine', 0.3, 0.005, 0.12, 0, 1440);
  blip(1080, 'sine', 0.2, 0.005, 0.1, 0.06, 2160);
}

/**
 * The seal chime — plays at NO other moment in the app. A slow, warm
 * major-arpeggio bloom, unmistakably different from the drill sounds.
 */
export function playSealChime(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    blip(f, 'sine', 0.28, 0.01, 0.9, i * 0.14);
    blip(f * 2, 'sine', 0.08, 0.01, 0.6, i * 0.14);
  });
}

/**
 * The consolidation chime — exclusive to the tenth-seal ceremony (ten jars
 * pouring into a denomination vessel). The seal chime's bigger sibling: an
 * octave down, slower cadence, longer ring, over a deep C3 root. The
 * ordinary seal chime stays exclusive to ordinary seals.
 */
export function playConsolidationChime(): void {
  blip(130.81, 'sine', 0.42, 0.02, 2.4); // C3 root
  blip(130.81 * 2.003, 'sine', 0.12, 0.02, 1.8); // slow beat against the root
  const notes = [261.63, 329.63, 392.0, 523.25]; // C4 E4 G4 C5
  notes.forEach((f, i) => {
    blip(f, 'sine', 0.3, 0.015, 1.7, 0.28 + i * 0.24);
    blip(f * 2, 'sine', 0.07, 0.015, 1.1, 0.28 + i * 0.24);
  });
}
