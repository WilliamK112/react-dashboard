import fs from 'node:fs/promises'
import process from 'node:process'
import puppeteer from 'puppeteer-core'

const DEFAULT_TIMEOUT_MS = 25000

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean)

async function pickExecutablePath() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await fs.access(path)
      return path
    } catch {
      // continue
    }
  }
  return null
}

function looksLikeMediaManifest(url) {
  if (typeof url !== 'string') return false
  const lower = url.toLowerCase()
  return lower.includes('.m3u8')
}

export async function resolveM3u8WithBrowser(pageUrl, logger = () => {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const executablePath = await pickExecutablePath()
  if (!executablePath) {
    throw new Error('browser resolver failed: 未找到可用 Chrome 可执行文件')
  }

  logger(`browser resolver using: ${executablePath}`)
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  })

  let timer
  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    )

    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('browser resolver failed: 抓取 m3u8 超时')), timeoutMs)

      const onRequest = (req) => {
        const url = req.url()
        if (!looksLikeMediaManifest(url)) return
        clearTimeout(timer)
        resolve(url)
      }

      page.on('request', onRequest)
      page
        .goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        .catch((error) => reject(new Error(`browser resolver failed: 页面加载失败：${error?.message || '未知错误'}`)))
    })

    logger(`browser resolver resolved m3u8: ${result}`)
    return { m3u8Url: result }
  } finally {
    if (timer) clearTimeout(timer)
    await browser.close().catch(() => {})
  }
}
