# Deploying Blockmarshal (Cloudflare Pages, Git integration)

Every push to `main` builds and deploys automatically once this is set up. Pushes to other branches get their own preview URLs.

## One-time setup (Cloudflare dashboard)

1. **Workers & Pages → Create → Pages → Connect to Git.** If the dashboard defaults to Workers, look for the Pages option.
2. Authorise the Cloudflare GitHub app for **only** `NigelRodgers/blockmarshal`, then select that repo.
3. Build settings:

   | Setting | Value |
   | --- | --- |
   | Project name | `blockmarshal` (gives `blockmarshal.pages.dev`; if taken, the name you pick becomes the subdomain) |
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | (leave empty) |

   Node 22 is picked up from `.node-version`.

4. **Environment variables** (Production, and Preview if you want analytics there too):

   | Variable | Value |
   | --- | --- |
   | `VITE_POSTHOG_KEY` | PostHog project API key (`phc_...`). Public, write-only. |
   | `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` or `https://eu.i.posthog.com`, matching your PostHog region |
   | `VITE_DAILY_EPOCH` | Launch date, `YYYY-MM-DD` (UTC). That day's puzzle is #1. **Set once, never change after launch.** |

5. **Save and Deploy.**

## After the first deploy

- [ ] Open the URL on a phone: tutorial starts on first visit.
- [ ] PostHog → Activity / Live events shows `app_open` within ~10 s. This confirms PostHog accepts the `text/plain` batch body.
- [ ] Menu shows the privacy line (only visible when a key is configured).
- [ ] Add to home screen / install, then open it in airplane mode: the game still loads.
- [ ] Share a daily result: the link in the text points at the production URL.
- [ ] Response headers on `/` include the `Content-Security-Policy` from `public/_headers`.

## What ships

- `public/_headers`: caching (immutable hashed assets, no-cache for `index.html` and `sw.js`) and security headers. The CSP allows network calls only to this site and `*.posthog.com`; update it if analytics moves elsewhere.
- `sw.js`: generated at build time by `vite.config.ts` with the exact files of that build. A new deploy replaces the old offline copy the next time the app is opened online.
