/**
 * Short git hash of this build, stamped on replays so they can be matched to the code
 * that played them. 'dev' when nothing was injected (tests, wrangler dev).
 * The client gets __BUILD__ from vite.config.ts, the Worker reads env.BUILD (set by scripts/deploy.mjs).
 */
export const BUILD_HASH: string = typeof __BUILD__ === 'string' ? __BUILD__.split(' ')[0] : 'dev';
