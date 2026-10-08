const MUTE_KEY = 'blockmarshal.muted';

export type SoundName = 'start' | 'fall';

const FILES: Record<SoundName, string> = {
  start: './sounds/start.mp3',
  fall: './sounds/fall.mp3',
};

/**
 * Game sound effects via Web Audio. Browsers (iOS especially) only allow audio
 * after a user gesture, so call unlock() from a tap; after that, play() works
 * any time, e.g. when the server says the match has started.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private loading: Promise<void> | null = null;
  muted: boolean;

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(MUTE_KEY);
    } catch {
      /* default: sound on */
    }
    this.muted = saved === '1';
  }

  /** Call from a click/tap handler. Creates the audio context and loads the clips. */
  unlock(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx ??= new Ctx();
    void this.ctx.resume();
    this.loading ??= this.load();
  }

  private async load(): Promise<void> {
    await Promise.all(
      (Object.keys(FILES) as SoundName[]).map(async (name) => {
        try {
          const res = await fetch(FILES[name]);
          this.buffers.set(name, await this.ctx!.decodeAudioData(await res.arrayBuffer()));
        } catch {
          /* missing sound is never fatal */
        }
      }),
    );
  }

  async play(name: SoundName): Promise<void> {
    if (this.muted || !this.ctx) return;
    await this.loading;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    src.start();
  }

  toggle(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* just won't be remembered */
    }
    return this.muted;
  }
}
