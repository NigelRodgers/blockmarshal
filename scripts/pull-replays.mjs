#!/usr/bin/env node
/**
 * Downloads finished games from the production database to this PC, then deletes them
 * from the server (the PC copy is the archive). Run by `npm run replays`, daily by the
 * Windows scheduled task "Blockmarshal replays".
 *
 *   Folder:  %BLOCKMARSHAL_REPLAYS% or "Documents\Blockmarshal Replays"
 *   Files:   <YYYY-MM>/<date>_<mode>_<id>.json   one replay each (watch with Replays > Import, or analyse)
 *            summary.csv                          one row per game, for spreadsheets
 *            pull.log                             what each run did
 *
 *   --local  read the `wrangler dev` database instead (testing)
 *   --keep   download but don't delete from the server
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const local = process.argv.includes('--local');
const keep = process.argv.includes('--keep');
const dir = process.env.BLOCKMARSHAL_REPLAYS || join(homedir(), 'Documents', 'Blockmarshal Replays');
const BATCH = 50;

function d1(sql) {
  const out = execFileSync(
    process.execPath,
    [wrangler, 'd1', 'execute', 'blockmarshal-feedback', local ? '--local' : '--remote', '--json', '--command', sql],
    { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  return parsed[0]?.results ?? [];
}

function csv(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(join(dir, 'pull.log'), stamped + '\n');
}

mkdirSync(dir, { recursive: true });
const summary = join(dir, 'summary.csv');
const HEADER = 'id,ended_at,mode,source,humans,turns,winner,winner_is_bot,players,file,build';
if (!existsSync(summary)) {
  writeFileSync(summary, HEADER + '\n');
} else {
  // Files from before the build column: add it, empty for the old rows.
  const old = readFileSync(summary, 'utf8');
  if (!old.startsWith(HEADER)) {
    const lines = old.split('\n').filter(Boolean);
    writeFileSync(summary, [HEADER, ...lines.slice(1).map((l) => l + ',')].join('\n') + '\n');
  }
}

let total = 0;
try {
  for (;;) {
    const rows = d1(`SELECT id, data FROM replays ORDER BY created_at LIMIT ${BATCH}`);
    if (!rows.length) break;
    for (const row of rows) {
      const r = JSON.parse(row.data);
      const ended = new Date(r.endedAt);
      const month = ended.toISOString().slice(0, 7);
      const name = `${ended.toISOString().slice(0, 16).replace(/[:T]/g, '-')}_${r.mode}_${r.id.slice(0, 8)}.json`;
      mkdirSync(join(dir, month), { recursive: true });
      writeFileSync(join(dir, month, name), JSON.stringify(r));
      const winner = r.players[r.winner];
      appendFileSync(
        summary,
        [
          r.id,
          ended.toISOString(),
          r.mode,
          r.source,
          r.players.filter((p) => !p.isBot).length,
          Math.floor(r.ticks / 2),
          winner?.name ?? '',
          winner ? winner.isBot : '',
          r.players.map((p) => (p.isBot ? `${p.name} (bot)` : p.name)).join('; '),
          `${month}/${name}`,
          r.build ?? '',
        ]
          .map(csv)
          .join(',') + '\n',
      );
    }
    total += rows.length;
    if (keep) break;
    // Only after every file in the batch is written.
    d1(`DELETE FROM replays WHERE id IN (${rows.map((r) => `'${String(r.id).replace(/[^a-z0-9-]/g, '')}'`).join(',')})`);
  }
  log(`pulled ${total} game(s) from ${local ? 'local' : 'production'} into ${dir}`);
} catch (err) {
  log(`FAILED after ${total} game(s): ${String(err.stderr || err.message).split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  process.exit(1);
}
