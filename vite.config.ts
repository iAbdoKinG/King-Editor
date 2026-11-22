import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: { target: 'es2020', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never);
