import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { ensureLocalModel, LOCAL_MODEL_REVISION } from '../src/local-model'

let directory: string
const jsonFiles = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'generation_config.json']
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'builder-cache-'))
  await fs.mkdir(join(directory, 'onnx'))
  for (const name of jsonFiles) await fs.writeFile(join(directory, name), '{}')
  const model = join(directory, 'onnx/model_quantized.onnx')
  await fs.writeFile(model, '')
  await fs.truncate(model, 512096557)
})
afterEach(async () => {
  jest.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

test('reuses valid cached files without network access', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch')
  await ensureLocalModel(directory, new AbortController().signal, jest.fn())
  expect(fetch).not.toHaveBeenCalled()
})

test('downloads only missing files from the pinned revision and removes stale partial files', async () => {
  await fs.rm(join(directory, 'config.json'))
  await fs.writeFile(join(directory, 'config.json.download'), 'interrupted')
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"model_type":"qwen2"}'))
  await ensureLocalModel(directory, new AbortController().signal, jest.fn())
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][0]).toBe(`https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/${LOCAL_MODEL_REVISION}/config.json`)
  expect(JSON.parse(await fs.readFile(join(directory, 'config.json'), 'utf8'))).toEqual({ model_type: 'qwen2' })
  await expect(fs.stat(join(directory, 'config.json.download'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('reports invalid downloaded JSON and removes partial files', async () => {
  await fs.rm(join(directory, 'config.json'))
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid'))
  await expect(ensureLocalModel(directory, new AbortController().signal, jest.fn())).rejects.toThrow()
  await expect(fs.stat(join(directory, 'config.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(join(directory, 'config.json.download'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('reports HTTP failures instead of creating a cache entry', async () => {
  await fs.rm(join(directory, 'config.json'))
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unavailable', { status: 503 }))
  await expect(ensureLocalModel(directory, new AbortController().signal, jest.fn())).rejects.toThrow('HTTP 503')
  await expect(fs.stat(join(directory, 'config.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('cancels downloads and removes partial files', async () => {
  await fs.rm(join(directory, 'config.json'))
  const controller = new AbortController()
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new TextEncoder().encode('{}'))
      controller.abort()
      stream.close()
    }
  })))
  await expect(ensureLocalModel(directory, controller.signal, jest.fn())).rejects.toThrow()
  await expect(fs.stat(join(directory, 'config.json.download'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(join(directory, 'config.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('rejects invalid cached JSON and symlinks explicitly', async () => {
  await fs.writeFile(join(directory, 'config.json'), 'invalid')
  await expect(ensureLocalModel(directory, new AbortController().signal, jest.fn())).rejects.toThrow()
  await fs.rm(join(directory, 'config.json'))
  await fs.symlink(join(directory, 'tokenizer.json'), join(directory, 'config.json'))
  await expect(ensureLocalModel(directory, new AbortController().signal, jest.fn())).rejects.toThrow('cache do modelo invalido')
})
