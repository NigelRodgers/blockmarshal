# Deploying Blockmarshal

Live at **https://blockmarshal.pages.dev** (Cloudflare Pages project `blockmarshal`, account [owner email: Worker secret]).

## How deploys work

Deploys are **direct uploads from this PC** with wrangler. Pushing to GitHub does **not** deploy. (Pages projects created by direct upload can't be switched to Git integration later; moving to auto-deploy would mean a new project.)

```bash
npm run deploy
```

That builds (`tsc` + `vite build`) and uploads `dist/` to the production branch `main`. Each upload also gets its own preview URL (`https://<hash>.blockmarshal.pages.dev`).

wrangler is a dev dependency and is already logged in on this machine (`npx wrangler whoami`). The project was created with `--force` because newer wrangler tries to route Pages commands to Cloudflare Workers; later commands don't need it.

## Build settings (read at build time from `.env.local`)

| Variable | Value |
| --- | --- |
| `VITE_POSTHOG_KEY` | PostHog project API key (`phc_...`). Public, write-only. Without it analytics are off. |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` or `https://eu.i.posthog.com`, matching your PostHog region |
| `VITE_DAILY_EPOCH` | `2026-10-10` (launch day, UTC; also the code default). **Never change after launch.** |

Copy `.env.example` to `.env.local` (gitignored), fill it in, then `npm run deploy`.

## Post-deploy checklist

- [x] Site loads, tutorial starts on first visit, no console errors (2026-10-02).
- [x] `_headers` applied: CSP, nosniff, `sw.js` served `no-cache` (2026-10-02).
- [x] Service worker activates and caches the build (2026-10-02).
- [ ] PostHog → Activity / Live events shows `app_open` within ~10 s of opening the site. Confirms PostHog accepts the `text/plain` batch body. Needs the key.
- [ ] Menu shows the privacy line (only visible when a key is configured).
- [ ] On a phone: add to home screen, then open it in airplane mode; the game still loads.
- [ ] Share a daily result: the link in the text is `https://blockmarshal.pages.dev/`.

## What ships

- `public/_headers`: caching (immutable hashed assets, no-cache for `index.html` and `sw.js`) and security headers. The CSP allows network calls only to this site and `*.posthog.com`; update it if analytics moves elsewhere.
- `sw.js`: generated at build time by `vite.config.ts` with the exact files of that build. A new deploy replaces the old offline copy the next time the app is opened online.
