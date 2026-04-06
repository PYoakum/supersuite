import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@calendar/ui': resolve(__dirname, '../../packages/ui'),
      '@calendar/types': resolve(__dirname, '../../packages/types/index.ts'),
      '@calendar/shared-utils': resolve(__dirname, '../../packages/shared-utils/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
