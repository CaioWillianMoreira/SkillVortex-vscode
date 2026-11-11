import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { buildSync } from 'esbuild'

export default defineConfig({
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  plugins: [{
    name: 'local-onnx-runtime',
    resolveId(id) { return id === 'virtual:builder-worker' ? '\0builder-worker' : undefined },
    load(id) {
      if (id !== '\0builder-worker') return
      const result = buildSync({
        entryPoints: [resolve(__dirname, 'product-builder.worker.ts')], bundle: true,
        platform: 'browser', format: 'esm', target: 'es2022', write: false, minify: true,
        define: { 'process.env.NODE_ENV': '"production"' }
      })
      return `export default ${JSON.stringify(result.outputFiles[0].text)}`
    },
    closeBundle() {
      const destination = resolve(__dirname, '../dist/webview/onnx')
      mkdirSync(destination, { recursive: true })
      for (const name of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
        copyFileSync(resolve(__dirname, '../node_modules/onnxruntime-web/dist', name), resolve(destination, name))
      }
      copyFileSync(resolve(__dirname, '../resources/onnxruntime-LICENSE.txt'), resolve(destination, 'LICENSE.txt'))
      copyFileSync(resolve(__dirname, '../node_modules/@huggingface/transformers/LICENSE'), resolve(destination, 'transformers-LICENSE.txt'))
    }
  }],
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
