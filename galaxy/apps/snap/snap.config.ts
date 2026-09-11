import type { SnapConfig } from '@metamask/snaps-cli';
import { resolve } from 'node:path';

const config: SnapConfig = {
  input: resolve(__dirname, 'src/index.tsx'),

  output: {
    path: resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    clean: true,
  },

  manifest: {
    path: resolve(__dirname, 'snap.manifest.json'),
    update: true,
  },

  server: {
    port: 8080,
  },
};

export default config;