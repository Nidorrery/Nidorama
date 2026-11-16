import { defineConfig } from 'vite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

export default defineConfig({
  base: './', // relative paths: works under HA ingress, the add-on port, and the Android shell
  define: {
    __APP_VERSION__: JSON.stringify(process.env.NIDORAMA_VERSION || pkg.version),
    // The GitHub repository this build belongs to (updates, requests log). GitHub Actions sets it; a local build has none.
    // Which channel this build was made for: 'dev' (main), 'private' (with the private layer) or '' (local).
    __CHANNEL__: JSON.stringify(process.env.NIDORAMA_CHANNEL || ''),
    // Is that repository private? Then nothing can be read from it without a token.
    __REPO_PRIVATE__: JSON.stringify((process.env.NIDORAMA_REPO_PRIVATE ?? 'true') !== 'false'),
    // Where the donate button in Settings goes (#119): a setting of the build, so a fork does not send money to this project.
    __DONATE_URL__: JSON.stringify(/^https:\/\//.test(process.env.NIDORAMA_DONATE_URL || '') ? process.env.NIDORAMA_DONATE_URL : ''),
    __REPO__: JSON.stringify(process.env.NIDORAMA_REPO || process.env.GITHUB_REPOSITORY || ''),
    // Official platform logos dropped into public/brands/ (see the README there) are picked up here.
    __BRAND_LOGOS__: JSON.stringify(existsSync(new URL('./public/brands', import.meta.url)) ? readdirSync(new URL('./public/brands', import.meta.url)).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)) : []),
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
});
