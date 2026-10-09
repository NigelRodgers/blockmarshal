#!/usr/bin/env node
/**
 * Board recording -> finished MP4 (intro card, the gameplay, outro card, optional music).
 *
 *   npm run video -- <recording.webm> [--title "1 vs 1 comeback"] [--music track.mp3] [--out video.mp4]
 *
 * Steps: transcode the browser's .webm (variable frame rate) to a steady 30 fps MP4 with
 * Remotion's bundled ffmpeg, read its size and length, then render the Gameplay composition.
 * Adapted from the video-tutorial-generator pipeline (Remotion compose step), minus the
 * WordPress recording, voiceover and lower-thirds.
 */
import { bundle } from '@remotion/bundler';
import { getVideoMetadata, renderMedia, selectComposition } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const title = opt('--title') ?? '';
const music = opt('--music');
const outArg = opt('--out');
const input = args[0];
if (!input || !existsSync(input)) {
  console.error('Usage: npm run video -- <recording.webm> [--title "..."] [--music track.mp3] [--out video.mp4]');
  process.exit(1);
}
const output = resolve(outArg ?? join(dirname(input), `${basename(input, extname(input))}.mp4`));

const pub = join(here, 'public');
mkdirSync(pub, { recursive: true });
const recording = join(pub, 'recording.mp4');
rmSync(join(pub, 'music.mp3'), { force: true });

// 1. Steady 30 fps H.264, even dimensions, longest side at most 1920.
console.log('Transcoding the recording…');
const cli = join(here, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
execFileSync(
  process.execPath,
  [
    cli,
    'ffmpeg',
    '-y',
    '-i',
    resolve(input),
    '-vf',
    // Remotion's ffmpeg only ships a few filters (scale yes, fps/format no): rate and pixel format as options.
    "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'",
    '-r',
    '30',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-an',
    recording,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'], cwd: here },
);
if (music) copyFileSync(resolve(music), join(pub, 'music.mp3'));

// 2. Size and length.
const meta = await getVideoMetadata(recording);
const even = (n) => Math.round(n / 2) * 2;
const inputProps = {
  title,
  recordingSeconds: meta.durationInSeconds,
  width: even(meta.width),
  height: even(meta.height),
  music: !!music,
};
console.log(`Recording: ${inputProps.width}x${inputProps.height}, ${meta.durationInSeconds.toFixed(1)} s`);

// 3. Render.
console.log('Rendering…');
const serveUrl = await bundle({ entryPoint: join(here, 'src', 'index.ts'), publicDir: pub });
const composition = await selectComposition({ serveUrl, id: 'Gameplay', inputProps });
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  outputLocation: output,
  inputProps,
  onProgress: ({ progress }) => process.stdout.write(`\r${Math.round(progress * 100)}%`),
});
console.log(`\nSaved ${output}`);
