import express from 'express'
import cors from 'cors'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { runDownloadWithFallback } from './lib/downloadOrchestrator.js'

const app = express()
const port = 8787
const downloadsDir = path.join(os.homedir(), 'Downloads')
const jobs = new Map()

app.use(cors())
app.use(express.json())

function createJob(url) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const job = {
    id,
    url,
    status: 'queued',
    progress: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    output: '',
    error: '',
  }
  jobs.set(id, job)
  return job
}

async function runJob(job, format = 'mp4') {
  job.status = 'downloading'
  job.updatedAt = new Date().toISOString()
  const log = (message) => {
    const line = `[orchestrator] ${message}\n`
    job.output = `${job.output}${line}`.slice(-12000)
    job.updatedAt = new Date().toISOString()
  }

  try {
    const result = await runDownloadWithFallback({
      pageUrl: job.url,
      format,
      outputTag: job.id,
      downloadsDir,
      spawnImpl: spawn,
      logger: log,
      setProgress: (value) => {
        if (Number.isFinite(value)) job.progress = value
      },
    })

    job.output = `${job.output}${result.output || ''}`.slice(-12000)
    job.updatedAt = new Date().toISOString()

    if (result.code === 0) {
      job.status = 'done'
      job.progress = 100
      return
    }

    job.status = 'failed'
    job.error = result.error || `下载失败（exit code ${result.code ?? 'unknown'}）`
  } catch (error) {
    job.updatedAt = new Date().toISOString()
    job.status = 'failed'
    job.error = `下载失败：${error?.message || '未知错误'}`
    job.output = `${job.output}\n${error?.stack || error?.message || ''}`.slice(-12000)
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/jobs', (_req, res) => {
  const data = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  )
  res.json({ jobs: data })
})

app.post('/api/download', (req, res) => {
  const { url, format } = req.body ?? {}
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: '请提供有效链接' })
    return
  }

  const job = createJob(url.trim())
  runJob(job, format === 'original' ? 'original' : 'mp4').catch(() => {})
  res.status(201).json({ job })
})

app.post('/api/download/batch', (req, res) => {
  const { urls, format } = req.body ?? {}
  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: '请提供至少一个链接' })
    return
  }

  const created = []
  for (const raw of urls) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const job = createJob(raw.trim())
    runJob(job, format === 'original' ? 'original' : 'mp4').catch(() => {})
    created.push(job)
  }

  res.status(201).json({ jobs: created })
})

app.post('/api/open-downloads', (_req, res) => {
  const child = spawn('open', [downloadsDir])
  child.on('close', () => {
    res.json({ ok: true, path: downloadsDir })
  })
})

app.listen(port, () => {
  console.log(`Download server running on http://localhost:${port}`)
})
