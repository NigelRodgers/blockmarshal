import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export const FPS = 30;
export const INTRO_FRAMES = 75; // 2.5 s
export const OUTRO_FRAMES = 75;
const FADE = 12;

export interface GameplayProps extends Record<string, unknown> {
  /** Optional line under the logo, e.g. "1 vs 1 · a comeback from 3 tiles". */
  title: string;
  recordingSeconds: number;
  width: number;
  height: number;
  /** public/music.mp3 is present: play it under the whole video. */
  music: boolean;
}

/** The game's own look: dark board background, white BLOCK, orange MARSHAL. */
const BG = '#12151b';
const ACCENT = '#f57c00';
const MUTED = '#95a0ae';

function Logo({ size }: { size: number }) {
  return (
    <div style={{ fontFamily: 'system-ui, Segoe UI, sans-serif', fontWeight: 900, fontSize: size, letterSpacing: size * 0.05, color: '#e8ecf1' }}>
      BLOCK<span style={{ color: ACCENT }}>MARSHAL</span>
    </div>
  );
}

function Card({ children, frames }: { children: React.ReactNode; frames: number }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, FADE, frames - FADE, frames], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  const rise = interpolate(frame, [0, FADE * 2], [24, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: BG, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ opacity, transform: `translateY(${rise}px)`, display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', padding: 40 }}>
        {children}
      </div>
    </AbsoluteFill>
  );
}

export function Gameplay({ title, recordingSeconds, music }: GameplayProps) {
  const { width, durationInFrames } = useVideoConfig();
  const base = Math.round(width / 12);
  const recFrames = Math.round(recordingSeconds * FPS);
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Sequence durationInFrames={INTRO_FRAMES}>
        <Card frames={INTRO_FRAMES}>
          <Logo size={base} />
          <div style={{ color: MUTED, fontFamily: 'system-ui, sans-serif', fontSize: base * 0.36 }}>Six generals. One minefield.</div>
          {title ? <div style={{ color: '#e8ecf1', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: base * 0.42 }}>{title}</div> : null}
        </Card>
      </Sequence>
      <Sequence from={INTRO_FRAMES} durationInFrames={recFrames}>
        <Recording frames={recFrames} />
      </Sequence>
      <Sequence from={INTRO_FRAMES + recFrames} durationInFrames={OUTRO_FRAMES}>
        <Card frames={OUTRO_FRAMES}>
          <Logo size={base * 0.8} />
          <div style={{ color: '#e8ecf1', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: base * 0.4 }}>Play free in your browser</div>
          <div style={{ color: ACCENT, fontFamily: 'system-ui, sans-serif', fontSize: base * 0.3 }}>blockmarshal.rodgersnigel.workers.dev</div>
        </Card>
      </Sequence>
      {music ? (
        <Audio
          src={staticFile('music.mp3')}
          volume={(f) => interpolate(f, [0, FPS, durationInFrames - FPS * 2, durationInFrames], [0, 0.35, 0.35, 0], { extrapolateRight: 'clamp' })}
        />
      ) : null}
    </AbsoluteFill>
  );
}

/** The board recording, faded in and out so the cuts to the title cards are soft. */
function Recording({ frames }: { frames: number }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, FADE, frames - FADE, frames], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo src={staticFile('recording.mp4')} muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </AbsoluteFill>
  );
}
