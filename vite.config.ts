import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Build number = number of commits. It shows on screen so a stale copy is easy to spot.
function buildNumber(): string {
  try {
    return execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '0';
  }
}
const BUILD = process.env.BUILD_NUMBER ?? buildNumber();

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 1500 },
  plugins: [
    {
      name: 'raptor-race-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ build: BUILD }),
        });
        const sw = readFileSync('src/sw.js', 'utf8').replaceAll('__BUILD__', BUILD);
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
      },
    },
  ],
});
