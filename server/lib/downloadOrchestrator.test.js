import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Buffer } from 'node:buffer'
import { runDownloadWithFallback } from './downloadOrchestrator.js'

function createSpawnMock(sequence) {
  let call = 0
  return () => {
    const current = sequence[call] || sequence[sequence.length - 1]
    call += 1
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    queueMicrotask(() => {
      if (current.stdout) proc.stdout.emit('data', Buffer.from(current.stdout))
      if (current.stderr) proc.stderr.emit('data', Buffer.from(current.stderr))
      proc.emit('close', current.code)
    })
    return proc
  }
}

test('primary success should not trigger fallback', async () => {
  let fallbackCalled = false
  const fallbackResolver = {
    async resolve() {
      fallbackCalled = true
      return { m3u8Url: 'https://fallback.example.com/test.m3u8' }
    },
  }

  const result = await runDownloadWithFallback({
    pageUrl: 'https://site.example.com/play/1',
    downloadsDir: '/tmp',
    spawnImpl: createSpawnMock([{ code: 0, stdout: '[download] 100%\n' }]),
    fallbackResolver,
  })

  assert.equal(result.strategy, 'primary')
  assert.equal(result.code, 0)
  assert.equal(fallbackCalled, false)
})

test('primary failure should trigger fallback and use resolved m3u8', async () => {
  let fallbackCalled = false
  const fallbackResolver = {
    async resolve() {
      fallbackCalled = true
      return { m3u8Url: 'https://fallback.example.com/test.m3u8' }
    },
  }

  const result = await runDownloadWithFallback({
    pageUrl: 'https://site.example.com/play/2',
    downloadsDir: '/tmp',
    spawnImpl: createSpawnMock([
      { code: 1, stderr: 'ERROR: Unsupported URL' },
      { code: 0, stdout: '[download] 100%\n' },
    ]),
    fallbackResolver,
  })

  assert.equal(fallbackCalled, true)
  assert.equal(result.strategy, 'fallback')
  assert.equal(result.code, 0)
  assert.equal(result.resolvedUrl, 'https://fallback.example.com/test.m3u8')
})

test('fallback failure should return clear error', async () => {
  const result = await runDownloadWithFallback({
    pageUrl: 'https://site.example.com/play/3',
    downloadsDir: '/tmp',
    spawnImpl: createSpawnMock([{ code: 1, stderr: 'ERROR: Unsupported URL' }]),
    fallbackResolver: {
      async resolve() {
        throw new Error('fallback failed: token missing')
      },
    },
  })

  assert.equal(result.strategy, 'fallback')
  assert.equal(result.code, 1)
  assert.match(result.error, /fallback 解析失败：fallback failed: token missing/)
})

test('primary failure without trigger signal should not run fallback', async () => {
  let called = false
  const result = await runDownloadWithFallback({
    pageUrl: 'https://site.example.com/play/4',
    downloadsDir: '/tmp',
    spawnImpl: createSpawnMock([{ code: 1, stderr: 'unknown exception' }]),
    fallbackResolver: {
      async resolve() {
        called = true
        return { m3u8Url: 'https://fallback.example.com/should-not.m3u8' }
      },
    },
  })

  assert.equal(called, false)
  assert.equal(result.code, 1)
  assert.match(result.error, /未命中 fallback 触发条件/)
})
