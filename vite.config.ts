import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Emits sw.js with the exact files of this build precached, versioned by a hash
 * of their names, so a new deploy replaces the old offline copy.
 */
function serviceWorker(): Plugin {
  return {
    name: 'blockmarshal-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const precache = [
        // './' is the page; Workers assets redirect /index.html to it.
        './',
        'manifest.webmanifest',
        'icon.svg',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'apple-touch-icon.png',
        'sounds/start.mp3',
        'sounds/fall.mp3',
        ...files,
      ];
      const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12);
      const source = readFileSync('sw/sw.js', 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify([...new Set(precache)]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** Short git hash + date, shown on the start screen so testers can tell which version they have. */
function buildId(): string {
  let hash = 'dev';
  try {
    hash = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    /* not a git checkout */
  }
  return `${hash} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// Relative base so the build works from file:// inside a Capacitor/WebView shell.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(buildId()) },
  server: {
    port: 5199,
    // Reachable from phones on the same Wi-Fi. /api and /ws go to the local Worker (npm run server).
    host: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  plugins: [serviceWorker()],
});
