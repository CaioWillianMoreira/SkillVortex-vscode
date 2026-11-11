import { env, pipeline, TextStreamer, type TextGenerationPipeline } from '@huggingface/transformers'
import { builderMarkdown, builderMessages, type BuilderSource, type BuilderReference } from '../src/product-builder-model'

let generator: TextGenerationPipeline | undefined
self.addEventListener('unhandledrejection', event => {
  self.postMessage({ type: 'error', message: event.reason instanceof Error ? event.reason.message : String(event.reason) })
})
self.onmessage = async (event: MessageEvent<{
  objective: string; sources: BuilderSource[]; runtimeModule: string; wasm: ArrayBuffer;
  references?: BuilderReference[];
  files: Array<{ name: string; buffer: ArrayBuffer }>
}>) => {
  try {
    env.allowLocalModels = true
    env.allowRemoteModels = false
    env.localModelPath = '/models/'
    env.useBrowserCache = false
    env.useCustomCache = true
    const wasmUrl = URL.createObjectURL(new Blob([event.data.wasm], { type: 'application/wasm' }))
    const fetchResource = self.fetch.bind(self)
    self.fetch = async (input, options) => {
      if (String(input) === wasmUrl) return fetchResource(input, options)
      throw new Error(`Recurso nao disponivel no modelo local: ${String(input)}`)
    }
    const files = new Map(event.data.files.map(file => [`/models/qwen/${file.name}`, file.buffer]))
    env.customCache = {
      match: async (key: string) => {
        const buffer = files.get(key)
        self.postMessage({ type: 'progress', message: `Carregando ${key.split('/').pop()}${buffer ? '' : ' (opcional ausente)'}` })
        if (!buffer) return undefined
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(buffer))
            controller.close()
          }
        })
        return new Response(body, { headers: { 'Content-Length': String(buffer.byteLength) } })
      },
      put: async () => { throw new Error('O modelo deve ser carregado apenas do armazenamento local.') }
    }
    const wasm = env.backends.onnx.wasm
    if (!wasm) throw new Error('Runtime WASM indisponivel neste ambiente.')
    wasm.wasmPaths = { mjs: event.data.runtimeModule, wasm: wasmUrl }
    wasm.numThreads = 1
    wasm.proxy = false
    wasm.initTimeout = 30000
    if (!generator) {
      self.postMessage({ type: 'progress', message: 'Carregando modelo local Qwen2.5 0.5B...' })
      generator = await pipeline<'text-generation'>('text-generation', 'qwen', {
        device: 'wasm', dtype: 'q8',
        session_options: { graphOptimizationLevel: 'all' },
        progress_callback: progress => {
          if (progress.status === 'progress') self.postMessage({ type: 'progress', message: `Modelo: ${progress.file} — ${Math.round(progress.progress)}%` })
        }
      })
      URL.revokeObjectURL(wasmUrl)
    }
    const messages = builderMessages(event.data.objective, event.data.sources, event.data.references)
    const prompt = generator.tokenizer.apply_chat_template(messages, { tokenize: false, add_generation_prompt: true })
    if (typeof prompt !== 'string') throw new Error('O modelo nao retornou um template de texto valido.')
    const tokens = generator.tokenizer(prompt)
    if (tokens.input_ids.size > 3072) throw new Error('Contexto grande demais para esta geracao local. Selecione menos notas ou reduza o objetivo.')
    self.postMessage({ type: 'progress', message: 'Gerando sugestoes locais. As regras originais da skill nao serao alteradas...' })
    let generated = ''
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true, skip_special_tokens: true,
      callback_function: text => {
        generated += text
        self.postMessage({ type: 'progress', message: `Gerando sugestoes locais: ${generated.length} caracteres...` })
      }
    })
    const result = await generator(prompt, { max_new_tokens: 256, do_sample: false, return_full_text: false, streamer })
    const first = result[0]
    if (!first || !('generated_text' in first) || typeof first.generated_text !== 'string' || !first.generated_text.trim()) {
      throw new Error('O modelo nao retornou texto. Tente novamente com um objetivo mais especifico.')
    }
    self.postMessage({ type: 'result', content: builderMarkdown(first.generated_text) })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
