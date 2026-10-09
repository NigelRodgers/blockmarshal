import { Composition } from 'remotion';
import { Gameplay, INTRO_FRAMES, OUTRO_FRAMES, FPS, type GameplayProps } from './Gameplay';

const defaults: GameplayProps = {
  title: '',
  recordingSeconds: 10,
  width: 1080,
  height: 1920,
  music: false,
};

/** One composition; render.mjs passes the recording's real size and length. */
export function Root() {
  return (
    <Composition
      id="Gameplay"
      component={Gameplay}
      fps={FPS}
      width={defaults.width}
      height={defaults.height}
      durationInFrames={INTRO_FRAMES + defaults.recordingSeconds * FPS + OUTRO_FRAMES}
      defaultProps={defaults}
      calculateMetadata={({ props }) => ({
        width: props.width,
        height: props.height,
        durationInFrames: INTRO_FRAMES + Math.round(props.recordingSeconds * FPS) + OUTRO_FRAMES,
      })}
    />
  );
}
