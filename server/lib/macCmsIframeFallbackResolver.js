import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { extractMacPlayerInfo, extractTokenFromHtml, parseResolveApiResponse } from './macCmsParsers.js'
import { resolveM3u8WithBrowser } from './browserM3u8Resolver.js'

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_RETRIES = 2
const PYTHON_HELPER_PATH = fileURLToPath(new URL('./macCmsPythonResolve.py', import.meta.url))

function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

function parseSetCookies(headers) {
  const setCookie = headers.getSetCookie?.() ?? []
  return setCookie
    .map((v) => {
      const [pair, ...attrs] = v.split(';').map((part) => part.trim())
      const domainAttr = attrs.find((attr) => /^domain=/i.test(attr))
      return {
        pair,
        domain: domainAttr ? domainAttr.split('=')[1]?.trim().replace(/^\./, '') : null,
      }
    })
    .filter((v) => v.pair)
}

class SessionClient {
  constructor(fetchImpl) {
    this.fetchImpl = fetchImpl
    this.cookies = new Map()
  }

  _storeCookies(response) {
    const responseHost = response.url ? new URL(response.url).hostname : null
    const list = parseSetCookies(response.headers)
    for (const item of list) {
      const idx = item.pair.indexOf('=')
      if (idx <= 0) continue
      const name = item.pair.slice(0, idx).trim()
      const value = item.pair.slice(idx + 1).trim()
      this.cookies.set(name, {
        value,
        domain: item.domain || responseHost,
        hostOnly: !item.domain,
      })
    }
  }

  _cookieHeader(url) {
    if (this.cookies.size === 0) return ''
    const host = new URL(url).hostname
    return Array.from(this.cookies.entries())
      .filter(([, meta]) => {
        if (!meta?.domain) return false
        if (meta.hostOnly) return host === meta.domain
        return host === meta.domain || host.endsWith(`.${meta.domain}`)
      })
      .map(([k, meta]) => `${k}=${meta.value}`)
      .join('; ')
  }

  async request(url, options = {}, retries = DEFAULT_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS) {
    let lastError
    for (let i = 0; i <= retries; i += 1) {
      const { signal, clear } = withTimeoutSignal(timeoutMs)
      try {
        const headers = new Headers(options.headers || {})
        const cookie = this._cookieHeader(url)
        if (cookie) headers.set('cookie', cookie)
        const response = await this.fetchImpl(url, { ...options, headers, signal })
        this._storeCookies(response)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`)
        }
        clear()
        return response
      } catch (error) {
        clear()
        lastError = error
      }
    }
    throw lastError
  }
}

function makeIframeBase(pageUrl, html) {
  const explicit = html.match(/https?:\/\/newplayer\.[a-zA-Z0-9.-]+/i)?.[0]
  if (explicit) return explicit

  const page = new URL(pageUrl)
  const host = page.hostname.replace(/^www\./, '')
  return `https://newplayer.${host}`
}

function makeEcUrl(iframeHtml, iframeUrl, pageUrl) {
  const iframe = new URL(iframeUrl)

  const withMainDomain = (target) => {
    if (!target.searchParams.get('main_domain')) {
      target.searchParams.set('main_domain', pageUrl)
    }
    return target.toString()
  }

  const absolute = iframeHtml.match(/https?:\/\/[^"' ]*\/ec\.php[^"' ]*/i)?.[0]
  if (absolute) {
    const absoluteUrl = new URL(absolute)
    if (!absoluteUrl.search && iframe.search) absoluteUrl.search = iframe.search
    return withMainDomain(absoluteUrl)
  }

  const relative = iframeHtml.match(/(?:\.\/)?ec\.php[^"' ]*/i)?.[0]
  if (relative) {
    const relativeUrl = new URL(relative, iframeUrl)
    if (!relativeUrl.search && iframe.search) relativeUrl.search = iframe.search
    return withMainDomain(relativeUrl)
  }

  if (iframe.pathname.endsWith('/ec.php')) return withMainDomain(iframe)
  iframe.pathname = iframe.pathname.replace(/index\.php$/i, 'ec.php')
  return withMainDomain(iframe)
}

function resolveViaPythonHelper(pageUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [PYTHON_HELPER_PATH, pageUrl])
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `python helper exited with code ${code}`))
        return
      }

      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error(`python helper returned invalid JSON: ${stdout.trim()}`))
      }
    })
  })
}

export class MacCmsIframeFallbackResolver {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || fetch
  }

  async resolve(pageUrl, logger = () => {}) {
    try {
      return await this.resolveWithNode(pageUrl, logger)
    } catch (error) {
      logger(`fallback node resolver failed: ${error?.message || '未知错误'}`)
      logger('fallback switching to browser resolver')
      try {
        return await resolveM3u8WithBrowser(pageUrl, logger)
      } catch (browserError) {
        logger(`fallback browser resolver failed: ${browserError?.message || '未知错误'}`)
      }
      logger('fallback switching to python helper')
      return resolveViaPythonHelper(pageUrl)
    }
  }

  async resolveWithNode(pageUrl, logger = () => {}) {
    const session = new SessionClient(this.fetchImpl)

    logger('fallback started: fetch play page')
    const pageRes = await session.request(pageUrl, {
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html,*/*' },
    })
    const pageHtml = await pageRes.text()

    const playerInfo = extractMacPlayerInfo(pageHtml)
    if (!playerInfo?.from || !playerInfo?.url) {
      throw new Error('fallback failed: 未找到 mac_player_info 或关键字段')
    }

    const title = playerInfo?.show || playerInfo?.title || 'video'
    const iframeBase = makeIframeBase(pageUrl, pageHtml)
    const iframeUrl = `${iframeBase}/player/index.php?code=ok&url=${encodeURIComponent(playerInfo.url)}&tittle=${encodeURIComponent(title)}`

    logger(`fallback started: fetch iframe ${iframeUrl}`)
    const iframeRes = await session.request(
      iframeUrl,
      {
        headers: {
          'user-agent': 'Mozilla/5.0',
          accept: 'text/html,*/*',
          referer: pageUrl,
          origin: new URL(pageUrl).origin,
        },
      },
    )
    const iframeHtml = await iframeRes.text()

    const ecUrl = makeEcUrl(iframeHtml, iframeRes.url || iframeUrl, pageUrl)
    const iframeOrigin = new URL(iframeRes.url || iframeUrl).origin
    logger(`fallback started: fetch ec ${ecUrl}`)
    const ecRes = await session.request(ecUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0',
        accept: 'text/html,*/*',
        referer: iframeRes.url || iframeUrl,
        origin: iframeOrigin,
      },
    })
    const ecHtml = await ecRes.text()

    const token = extractTokenFromHtml(ecHtml)
    if (!token) throw new Error('fallback failed: ec.php 未提取到 token')

    const resolveUrl = `${iframeOrigin}/index.php/api/resolve/url`
    logger(`fallback started: resolve api ${resolveUrl}`)
    const body = new URLSearchParams({ token }).toString()

    const startedAt = Date.now()
    while (Date.now() - startedAt < 60000) {
      const resolveRes = await session.request(resolveUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          accept: 'application/json,text/plain,*/*',
          referer: ecRes.url || ecUrl,
          origin: iframeOrigin,
        },
        body,
      })

      const text = await resolveRes.text()
      let json
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error('fallback failed: resolve/url 未返回有效 JSON')
      }

      const m3u8Url = parseResolveApiResponse(json)
      if (m3u8Url) {
        logger(`fallback resolved m3u8: ${m3u8Url}`)
        return { m3u8Url, context: { from: playerInfo.from, encrypt: playerInfo.encrypt, link_next: playerInfo.link_next, link_pre: playerInfo.link_pre, id: playerInfo.id, sid: playerInfo.sid, nid: playerInfo.nid } }
      }

      const retryAfterMs = json?.data?.retry_after_ms
      if (json?.code === 0 && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        logger(`fallback resolve waiting ${retryAfterMs}ms`)
        await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfterMs, 35000)))
        continue
      }

      break
    }

    throw new Error('fallback failed: resolve/url 返回中未找到 data.url')
  }
}
