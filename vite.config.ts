import { createHash } from 'node:crypto';
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
        './',
        'index.html',
        'manifest.webmanifest',
        'icon.svg',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'apple-touch-icon.png',
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

// Relative base so the build works from file:// inside a Capacitor/WebView shell.
export default defineConfig({
  base: './',
  server: {
    port: 5199,
    // Reachable from phones on the same Wi-Fi; /ws goes to the game server (npm run server).
    host: true,
    proxy: { '/ws': { target: 'ws://localhost:5200', ws: true } },
  },
  plugins: [serviceWorker()],
});
