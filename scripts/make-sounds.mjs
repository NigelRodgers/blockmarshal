#!/usr/bin/env node
/**
 * Synthesises the game's sound effects from code (our own audio, no licences needed) and
 * writes them to public/sounds as MP3 (needs ffmpeg on PATH). Deterministic: same output
 * every run. `node scripts/make-sounds.mjs`
 *
 * Family: a brass horn on E2 (82.4 Hz) and a low boom. The original clips were a brass
 * horn on the same note and a ~56 Hz boom; these keep that character.
 *   horn     2.0 s  match start
 *   thud     0.45 s mine going off (a small version of the boom)
 *   fall     2.6 s  your general falls: boom + a horn note sagging down
 *   capture  2.0 s  you take a crown: shorter boom + a rising two-note horn call
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');
const E2 = 82.41;

/** Seeded noise so every run produces identical files. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const buf = (secs) => new Float32Array(Math.round(secs * SR));

/** One-pole low-pass, in place. */
function lowpass(x, hz) {
  const a = Math.exp((-2 * Math.PI * hz) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) x[i] = y = (1 - a) * x[i] + a * y;
  return x;
}

function mixInto(dst, src, at = 0, gain = 1) {
  const o = Math.round(at * SR);
  for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * gain;
  return dst;
}

/**
 * Brass voice: harmonic series rolling off like a horn, brighter as it gets louder
 * (the "blat"), gentle vibrato after the attack. `pitch(t)` gives Hz over time,
 * `env(t)` the loudness 0..1.
 */
function horn(secs, pitch, env, seed = 1) {
  const x = buf(secs);
  const r = rng(seed);
  const phase = new Float64Array(24);
  const detune = [1, 1.0017]; // two slightly detuned players for width
  for (const d of detune) {
    phase.fill(0);
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      const e = env(t);
      if (e <= 0) continue;
      const vib = 1 + (t > 0.35 ? 0.0035 * Math.sin(2 * Math.PI * 5.2 * t) : 0);
      const f0 = pitch(t) * vib * d;
      let s = 0;
      for (let n = 1; n <= 20; n++) {
        const f = f0 * n;
        if (f > 5000) break;
        phase[n] += (2 * Math.PI * f) / SR;
        // Brightness: higher harmonics only come in as the note gets loud.
        const amp = Math.pow(n, -0.5) * Math.pow(e, 0.05 * (n - 1));
        s += amp * Math.sin(phase[n]);
      }
      x[i] += (s * e) / detune.length;
    }
  }
  // A little breath in the attack.
  const breath = lowpass(buf(secs).map(() => r() * 2 - 1), 1800);
  for (let i = 0; i < x.length; i++) x[i] += breath[i] * 0.025 * env(i / SR) * Math.exp(-(i / SR) / 0.25);
  return lowpass(x, 4200);
}

/** Low boom: a sine dropping in pitch plus low rumble noise. */
function boom(secs, { from = 75, to = 38, drop = 0.6, tau = 0.7, rumble = 0.5, click = 0.4, seed = 2 } = {}) {
  const x = buf(secs);
  const r = rng(seed);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const f = to + (from - to) * Math.exp(-t / (drop / 3));
    ph += (2 * Math.PI * f) / SR;
    const attack = Math.min(1, t / 0.004);
    x[i] = Math.sin(ph) * attack * Math.exp(-t / tau);
  }
  const noise = lowpass(lowpass(buf(secs).map(() => r() * 2 - 1), 220), 220);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const wobble = 0.7 + 0.3 * Math.sin(2 * Math.PI * 7 * t + 1.3);
    x[i] += noise[i] * 9 * rumble * wobble * Math.min(1, t / 0.01) * Math.exp(-t / (tau * 1.2));
  }
  // The crack at the start of the blast.
  const crack = lowpass(buf(0.03).map(() => r() * 2 - 1), 1500);
  for (let i = 0; i < crack.length; i++) x[i] += crack[i] * click * Math.exp(-(i / SR) / 0.008);
  return x;
}

function normalize(x, peak) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < x.length; i++) x[i] = (x[i] / m) * peak;
  // 10 ms fade-out so nothing clicks at the end.
  const n = Math.round(0.01 * SR);
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n;
  return x;
}

/** Note envelope: attack with a small overshoot, sustain, exponential release. */
function note(attack, hold, release) {
  return (t) => {
    if (t < attack) return (t / attack) * 1.08;
    if (t < attack + 0.08) return 1.08 - ((t - attack) / 0.08) * 0.08;
    if (t < attack + hold) return 1;
    return Math.exp(-(t - attack - hold) / (release / 4));
  };
}

const sounds = {
  horn: normalize(horn(2.0, () => E2, note(0.12, 1.35, 0.5)), 0.72),

  thud: normalize(boom(0.45, { from: 115, to: 48, drop: 0.15, tau: 0.11, rumble: 0.35, click: 0.6, seed: 5 }), 0.9),

  fall: (() => {
    const x = boom(2.6, { from: 72, to: 36, drop: 0.7, tau: 0.75, rumble: 0.6, seed: 7 });
    // A horn note sagging from E2 down a fourth (to B1): the crown is gone.
    const sag = horn(2.1, (t) => E2 * Math.pow(2, (-5 / 12) * Math.min(1, t / 1.6)), note(0.18, 0.9, 0.9), 3);
    return normalize(mixInto(x, sag, 0.25, 0.55), 0.9);
  })(),

  capture: (() => {
    const x = boom(2.0, { from: 80, to: 40, drop: 0.45, tau: 0.45, rumble: 0.45, seed: 9 });
    // Rising call: E2 then B2 (a fifth up), short and proud.
    mixInto(x, horn(0.5, () => E2, note(0.05, 0.28, 0.15), 4), 0.12, 0.6);
    mixInto(x, horn(1.4, () => E2 * 1.5, note(0.06, 0.75, 0.55), 6), 0.48, 0.65);
    return normalize(x, 0.88);
  })(),
};

function wav(x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  return b;
}

mkdirSync(out, { recursive: true });
const tmp = join(tmpdir(), 'blockmarshal-sounds');
mkdirSync(tmp, { recursive: true });
for (const [name, x] of Object.entries(sounds)) {
  const w = join(tmp, `${name}.wav`);
  writeFileSync(w, wav(x));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', w, '-c:a', 'libmp3lame', '-b:a', '96k', join(out, `${name}.mp3`)]);
  if (process.argv.includes('--wav')) writeFileSync(join(out, `${name}.wav`), wav(x));
  console.log(`${name}.mp3  ${(x.length / SR).toFixed(2)} s`);
}
rmSync(tmp, { recursive: true, force: true });
