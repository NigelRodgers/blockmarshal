import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import type { Conn } from './match';
import { Matchmaker } from './matchmaker';

const PORT = Number(process.env.PORT) || 5200;
const DIST = join(import.meta.dirname, '..', 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const matchmaker = new Matchmaker();

/** Serves the built client too (if dist/ exists), so production can be one process. */
const http = createServer((req, res) => {
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Blockmarshal game server. WebSocket at /ws');
    return;
  }
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096 });
let nextConn = 1;

wss.on('connection', (ws: WebSocket) => {
  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);

  const conn: Conn = {
    id: `c${nextConn++}`,
    name: 'Player',
    send(msg: ServerMessage) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };

  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg?.t === 'join') matchmaker.join(conn, msg.name);
    else if (msg?.t === 'leave') matchmaker.leave(conn);
    else conn.match?.input(conn, msg);
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    matchmaker.leave(conn);
  });
});

http.listen(PORT, () => console.log(`Blockmarshal server on http://localhost:${PORT} (ws /ws)`));
