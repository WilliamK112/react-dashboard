import { spawn } from 'node:child_process'
import { MacCmsIframeFallbackResolver } from './macCmsIframeFallbackResolver.js'
import { shouldTriggerFallback } from './macCmsParsers.js'

const IDLE_TIMEOUT_MS = 180000

function runYtDlp(url, argsPrefix = [], spawnImpl = spawn, idleTimeoutMs = IDLE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const args = [...argsPrefix, url]
    const child = spawnImpl('yt-dlp', args)
    let output = ''
    let settled = false
    let idleTimer

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (settled) return
        output = `${output}\nERROR: yt-dlp stalled: no output for ${idleTimeoutMs}ms`
        child.kill('SIGTERM')
      }, idleTimeoutMs)
    }

    const finalize = (code) => {
      if (settled) return
      settled = true
      if (idleTimer) clearTimeout(idleTimer)
      resolve({ code, output })
    }

    resetIdleTimer()

    child.stdout.on('data', (chunk) => {
      resetIdleTimer()
      const text = chunk.toString()
      output = `${output}${text}`.slice(-12000)
      const lines = text.split('\n')
      for (const line of lines) {
        const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
        if (match?.[1]) {
          // keep progress updates aligned with existing state model
          // caller passes handler in closure via argsPrefix options.
        }
      }
    })
    child.stderr.on('data', (chunk) => {
      resetIdleTimer()
      output = `${output}${chunk.toString()}`.slice(-12000)
    })
    child.on('close', (code) => {
      finalize(code)
    })
    child.on('error', (error) => {
      output = `${output}\nERROR: spawn yt-dlp failed: ${error?.message || 'unknown error'}`.slice(-12000)
      finalize(1)
    })
  })
}

export async function runDownloadWithFallback(options) {
  const {
    pageUrl,
    format = 'mp4',
    outputTag = '',
    downloadsDir,
    logger = () => {},
    setProgress = () => {},
    spawnImpl = spawn,
    fallbackResolver = new MacCmsIframeFallbackResolver(),
  } = options

  // Force best available quality first: highest resolution/fps/bitrate.
  const safeTag = String(outputTag || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40)
  const outputTemplate = safeTag
    ? `${safeTag}-%(title).120B [%(id)s].%(ext)s`
    : '%(title).120B [%(id)s].%(ext)s'

  const prefix = [
    '--newline',
    '-f',
    'bestvideo*+bestaudio/best',
    '-S',
    'res,fps,tbr,vcodec,acodec',
    '--user-agent',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    '--concurrent-fragments',
    '8',
    '--retries',
    '10',
    '--fragment-retries',
    '10',
    '-o',
    outputTemplate,
    '-P',
    downloadsDir,
  ]
  if (format === 'mp4') {
    prefix.push('--merge-output-format', 'mp4')
  }

  logger('primary started')
  const primary = await runYtDlp(pageUrl, prefix, spawnImpl)
  for (const line of primary.output.split('\n')) {
    const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
    if (match?.[1]) setProgress(Number.parseFloat(match[1]))
  }

  if (primary.code === 0) {
    return {
      strategy: 'primary',
      code: 0,
      output: primary.output,
      sourceUrl: pageUrl,
    }
  }

  logger('primary failed')
  if (!shouldTriggerFallback(primary)) {
    return {
      strategy: 'primary',
      code: primary.code,
      output: primary.output,
      error: '主方案失败，且未命中 fallback 触发条件',
    }
  }

  logger('fallback started')
  let resolved
  try {
    resolved = await fallbackResolver.resolve(pageUrl, logger)
  } catch (error) {
    return {
      strategy: 'fallback',
      code: 1,
      output: primary.output,
      error: `fallback 解析失败：${error?.message || '未知错误'}`,
    }
  }

  logger('fallback download started')
  const fallback = await runYtDlp(resolved.m3u8Url, prefix, spawnImpl)
  for (const line of fallback.output.split('\n')) {
    const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
    if (match?.[1]) setProgress(Number.parseFloat(match[1]))
  }

  if (fallback.code !== 0) {
    return {
      strategy: 'fallback',
      code: fallback.code,
      output: `${primary.output}\n${fallback.output}`,
      error: 'fallback 解析成功但下载失败',
      resolvedUrl: resolved.m3u8Url,
    }
  }

  logger('fallback download completed')
  return {
    strategy: 'fallback',
    code: 0,
    output: `${primary.output}\n${fallback.output}`,
    resolvedUrl: resolved.m3u8Url,
  }
}
