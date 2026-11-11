import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { hasErrorCode } from './model'

export const LOCAL_MODEL_REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'
const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'generation_config.json', 'onnx/model_quantized.onnx'] as const

async function validateJson(path: string): Promise<void> {
  const parsed: unknown = JSON.parse(await fs.readFile(path, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON do modelo local invalido.')
}

export async function ensureLocalModel(directory: string, signal: AbortSignal, progress: (message: string) => void): Promise<void> {
  await fs.mkdir(join(directory, 'onnx'), { recursive: true })
  for (const file of files) {
    signal.throwIfAborted()
    const destination = join(directory, file)
    const expectedSize = file.endsWith('.onnx') ? 512096557 : undefined
    try {
      const stat = await fs.lstat(destination)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Arquivo de cache do modelo invalido.')
      if (expectedSize ? stat.size === expectedSize : stat.size > 0 && stat.size <= 20 * 1024 * 1024) {
        if (!expectedSize) await validateJson(destination)
        continue
      }
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
    }
    progress(`Baixando modelo local: ${file}...`)
    const response = await fetch(`https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/${LOCAL_MODEL_REVISION}/${file}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60 * 1000)])
    })
    if (!response.ok || !response.body) throw new Error(`Falha ao baixar ${file}: HTTP ${response.status}.`)
    const temporary = `${destination}.download`
    await fs.rm(temporary, { force: true })
    const handle = await fs.open(temporary, 'wx')
    let size = 0
    let lastPercent = -1
    const total = Number(response.headers.get('content-length'))
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted()
        size += chunk.length
        if (size > (expectedSize ?? 20 * 1024 * 1024)) throw new Error('Arquivo do modelo maior que o esperado.')
        await handle.writeFile(chunk)
        const percent = total > 0 ? Math.floor(size / total * 100) : -1
        if (percent >= 0 && percent !== lastPercent) {
          lastPercent = percent
          progress(`Baixando ${file}: ${percent}%`)
        }
      }
      if (!size || (expectedSize && size !== expectedSize)) throw new Error(`Download incompleto: ${file}. Tente novamente.`)
      await handle.close()
      if (!expectedSize) await validateJson(temporary)
      await fs.rename(temporary, destination)
    } finally {
      await handle.close()
      await fs.rm(temporary, { force: true })
    }
  }
}
