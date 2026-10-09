/**
 * Owner-only gameplay recorder. Records the board canvas itself (sharp, no browser chrome,
 * no menus or notices) to a .webm that downloads when you stop. Turn it on in a browser
 * once with `?recorder=on` (off with `?recorder=off`); it's remembered in that browser.
 * Finished recordings become an MP4 with intro/outro via `npm run video -- <file.webm>`.
 */
const KEY = 'blockmarshal.recorder';

export function recorderEnabled(): boolean {
  const flag = new URLSearchParams(location.search).get('recorder');
  try {
    if (flag === 'on') localStorage.setItem(KEY, '1');
    if (flag === 'off') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return flag === 'on';
  }
}

function pickMime(): string {
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export class CanvasRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private discard = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get recording(): boolean {
    return this.rec?.state === 'recording';
  }

  /** Seconds since recording started. */
  get elapsed(): number {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  start(): boolean {
    if (this.recording || typeof MediaRecorder === 'undefined') return false;
    const mimeType = pickMime();
    const stream = this.canvas.captureStream(30);
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.discard = false;
    this.rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (!this.discard) this.download(new Blob(this.chunks, { type: mimeType || 'video/webm' }));
      this.chunks = [];
    };
    this.rec.start(1000);
    this.startedAt = performance.now();
    return true;
  }

  stop(): void {
    if (this.recording) this.rec!.stop();
  }

  /** Stop and throw the recording away (no download). */
  cancel(): void {
    if (!this.recording) return;
    this.discard = true;
    this.rec!.stop();
  }

  private download(blob: Blob): void {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `blockmarshal-${stamp}.${ext}`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
}
