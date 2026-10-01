import { defineConfig } from 'vite';

// Relative base so the build works from file:// inside a Capacitor/WebView shell.
export default defineConfig({
  base: './',
  server: { port: 5199 },
});
