import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    minify: 'esbuild',
    outDir: resolve(__dirname, '../dist/webview'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: resolve(__dirname, 'main.tsx'), name: 'SkillVortex', formats: ['iife'], fileName: () => 'app.js' },
    rollupOptions: { output: { assetFileNames: asset => asset.names.some(name => name.endsWith('.css')) ? 'app.css' : '[name][extname]' } }
  }
})
