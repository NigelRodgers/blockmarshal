#!/usr/bin/env node
/**
 * `npm run deploy` (after `npm run build`): wrangler deploy with the git hash set as the
 * BUILD var, so replays from server-run games carry the same build id as the client.
 */
import { execSync, spawnSync } from 'node:child_process';

let hash = 'dev';
try {
  hash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout */
}
const r = spawnSync('npx', ['wrangler', 'deploy', '--var', `BUILD:${hash}`], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
