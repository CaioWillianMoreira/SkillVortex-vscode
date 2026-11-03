import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  build: {
    minify: 'esbuild',
    outDir: resolve(__dirname, '../dist/webview'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: resolve(__dirname, 'main.tsx'), formats: ['es'], fileName: () => 'app.js' },
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: asset => asset.names.some(name => name.endsWith('.css')) ? 'app.css' : 'assets/[name]-[hash][extname]'
      }
    }
  }
})
