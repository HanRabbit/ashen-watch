import { defineConfig } from 'vite';

// base 用相对路径，产物可放在任意静态 HTTP 目录下运行（PRD 第 10 节）。
export default defineConfig({
  base: './',
  cacheDir: '.cache/vite',
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  server: { port: 5173, strictPort: false },
  preview: { port: 4173, strictPort: false },
  test: { include: ['tests/**/*.test.{ts,js}'], environment: 'node' },
});
