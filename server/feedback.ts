/** What the in-game feedback form sends. Everything is optional except that something must be said. */
export interface FeedbackInput {
  rating?: unknown;
  confusing?: unknown;
  improve?: unknown;
  context?: unknown;
  /** Honeypot: hidden from people, so only bots fill it in. */
  website?: unknown;
}

export interface FeedbackRecord {
  rating: number | null;
  confusing: string | null;
  improve: string | null;
  context: string;
}

export const MAX_TEXT = 1000;
const MAX_CONTEXT_VALUE = 64;
const CONTEXT_KEYS = ['screen', 'turn', 'result', 'humans', 'device', 'viewport', 'version'] as const;

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, MAX_TEXT);
  return s || null;
}

/** Keep only known, short, primitive context fields so nothing personal or bulky sneaks in. */
function context(v: unknown): string {
  const out: Record<string, string | number | boolean> = {};
  if (v && typeof v === 'object') {
    for (const key of CONTEXT_KEYS) {
      const val = (v as Record<string, unknown>)[key];
      if (typeof val === 'number' && Number.isFinite(val)) out[key] = val;
      else if (typeof val === 'boolean') out[key] = val;
      else if (typeof val === 'string') out[key] = val.slice(0, MAX_CONTEXT_VALUE);
    }
  }
  return JSON.stringify(out);
}

/** Plain-text email for one submission. */
export function feedbackEmail(r: FeedbackRecord): { subject: string; text: string } {
  const faces = ['', '😖', '🙁', '😐', '🙂', '🤩'];
  const fun = r.rating ? `${r.rating}/5 ${faces[r.rating]}` : 'no rating';
  const ctx = JSON.parse(r.context) as Record<string, unknown>;
  return {
    subject: `Blockmarshal feedback: ${fun}`,
    text: [
      `Fun: ${fun}`,
      '',
      'Anything confusing?',
      r.confusing ?? '(blank)',
      '',
      'What would make you play again?',
      r.improve ?? '(blank)',
      '',
      `Context: ${Object.entries(ctx)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || 'none'}`,
      '',
      'All responses: npm run feedback (or Cloudflare dashboard > D1 > blockmarshal-feedback).',
    ].join('\n'),
  };
}

/** Validates a submission. Returns null for spam (honeypot filled) or empty feedback. */
export function cleanFeedback(input: FeedbackInput): FeedbackRecord | null {
  if (typeof input.website === 'string' && input.website.trim()) return null;
  const r = Number(input.rating);
  const rating = Number.isInteger(r) && r >= 1 && r <= 5 ? r : null;
  const confusing = text(input.confusing);
  const improve = text(input.improve);
  if (rating === null && !confusing && !improve) return null;
  return { rating, confusing, improve, context: context(input.context) };
}
