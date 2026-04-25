import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'

const COPY = {
  en: {
    parseError: 'Unexpected server response. Please make sure `npm run dev:server` is running.',
    serverNotRunning: 'Backend server is not running. Please start it with `npm run dev:server`.',
    submitFailed: 'Submit failed',
    batchSubmitFailed: 'Batch submit failed',
    addedQueue: 'Added to queue',
    batchSuccess: 'Batch submitted',
    jobsUnit: 'jobs',
    openDownloadsFailed: 'Failed to open downloads folder. Please check backend service.',
    eyebrow: 'Video Downloader Dashboard',
    title: 'Download Control Center',
    subtitle: 'Only download content you own or are authorized to use',
    openDownloads: 'Open Downloads',
    totalJobs: 'Total Jobs',
    downloading: 'Downloading',
    done: 'Completed',
    failed: 'Failed',
    newDownload: 'New Download',
    singleLink: 'Single URL',
    pasteLink: 'Paste video URL',
    mp4Recommended: 'mp4 (recommended)',
    originalFormat: 'Original format',
    addJob: 'Add Job',
    batchDownload: 'Batch Download',
    oneUrlPerLine: 'One URL per line',
    submitBatch: 'Submit Batch',
    jobStatus: 'Job Status',
    autoRefresh: 'Refresh every 1.2s',
    hint: 'Hint',
    noJobs: 'No jobs yet. Paste a link to get started.',
    language: '中文',
    logoAlt: 'Video Downloader Dashboard logo',
    status: {
      queued: 'queued',
      downloading: 'downloading',
      done: 'done',
      failed: 'failed',
    },
  },
  zh: {
    parseError: '后端返回异常，请确认 `npm run dev:server` 正在运行。',
    serverNotRunning: '后端服务未启动，请先运行 `npm run dev:server`。',
    submitFailed: '提交失败',
    batchSubmitFailed: '批量提交失败',
    addedQueue: '已加入下载队列',
    batchSuccess: '批量提交成功',
    jobsUnit: '个任务',
    openDownloadsFailed: '打开下载目录失败，请确认后端服务正常',
    eyebrow: '视频下载控制台',
    title: '链接下载面板',
    subtitle: '仅用于你有版权或授权的视频资源',
    openDownloads: '打开下载目录',
    totalJobs: '总任务',
    downloading: '下载中',
    done: '已完成',
    failed: '失败',
    newDownload: '新建下载',
    singleLink: '单个链接',
    pasteLink: '粘贴视频链接',
    mp4Recommended: 'mp4（推荐）',
    originalFormat: '原始格式',
    addJob: '添加任务',
    batchDownload: '批量下载',
    oneUrlPerLine: '每行一个链接',
    submitBatch: '提交批量任务',
    jobStatus: '任务状态',
    autoRefresh: '每 1.2 秒刷新',
    hint: '提示',
    noJobs: '暂无任务，先贴一个链接试试。',
    language: 'EN',
    logoAlt: '视频下载控制台 logo',
    status: {
      queued: '排队中',
      downloading: '下载中',
      done: '已完成',
      failed: '失败',
    },
  },
}

async function readJsonSafely(response, parseErrorMessage) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(parseErrorMessage)
  }
}

function App() {
  const [locale, setLocale] = useState('en')
  const [url, setUrl] = useState('')
  const [batch, setBatch] = useState('')
  const [format, setFormat] = useState('mp4')
  const [jobs, setJobs] = useState([])
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pointer, setPointer] = useState({ x: 50, y: 20, inside: false })
  const [scrollProgress, setScrollProgress] = useState(0)
  const [visibleSections, setVisibleSections] = useState({})
  const sectionRefs = useRef({})
  const copy = COPY[locale]

  async function loadJobs() {
    const response = await fetch('/api/jobs')
    const data = await readJsonSafely(response, copy.parseError)
    setJobs(data.jobs ?? [])
  }

  useEffect(() => {
    setTimeout(() => {
      loadJobs().catch(() => {
        setMessage(copy.serverNotRunning)
      })
    }, 0)
    const timer = setInterval(() => {
      loadJobs().catch(() => {})
    }, 1200)
    return () => clearInterval(timer)
  }, [copy.serverNotRunning])

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || 0
      const progress = Math.min(1, y / 180)
      setScrollProgress(progress)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const key = entry.target.getAttribute('data-section')
          if (!key) continue
          setVisibleSections((prev) => (prev[key] ? prev : { ...prev, [key]: true }))
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.2 },
    )

    const targets = Object.values(sectionRefs.current).filter(Boolean)
    for (const target of targets) observer.observe(target)
    return () => observer.disconnect()
  }, [])

  const stats = useMemo(() => {
    const total = jobs.length
    const downloading = jobs.filter((j) => j.status === 'downloading').length
    const done = jobs.filter((j) => j.status === 'done').length
    const failed = jobs.filter((j) => j.status === 'failed').length
    return { total, downloading, done, failed }
  }, [jobs])

  async function createSingleJob(event) {
    event.preventDefault()
    if (!url.trim()) return
    setIsSubmitting(true)
    setMessage('')
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), format }),
      })
      const data = await readJsonSafely(response, copy.parseError)
      if (!response.ok) {
        throw new Error(data.error ?? copy.submitFailed)
      }
      setUrl('')
      setMessage(`${copy.addedQueue}: ${data.job.url}`)
      await loadJobs()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function createBatchJobs() {
    const urls = batch
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (urls.length === 0) return

    setIsSubmitting(true)
    setMessage('')
    try {
      const response = await fetch('/api/download/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, format }),
      })
      const data = await readJsonSafely(response, copy.parseError)
      if (!response.ok) {
        throw new Error(data.error ?? copy.batchSubmitFailed)
      }
      setBatch('')
      setMessage(`${copy.batchSuccess}: ${data.jobs.length} ${copy.jobsUnit}`)
      await loadJobs()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function openDownloadsFolder() {
    try {
      await fetch('/api/open-downloads', { method: 'POST' })
    } catch {
      setMessage(copy.openDownloadsFailed)
    }
  }

  function registerSection(sectionName) {
    return (node) => {
      sectionRefs.current[sectionName] = node
    }
  }

  function handleDashboardMouseMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    setPointer({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)), inside: true })
  }

  function handleDashboardMouseLeave() {
    setPointer((prev) => ({ ...prev, inside: false }))
  }

  return (
    <main
      className="dashboard"
      style={{
        '--mx': `${pointer.x}%`,
        '--my': `${pointer.y}%`,
        '--scroll-progress': scrollProgress.toFixed(3),
      }}
      onMouseMove={handleDashboardMouseMove}
      onMouseLeave={handleDashboardMouseLeave}
    >
      <div className={`mouse-glow ${pointer.inside ? 'is-active' : ''}`} />
      <header className="header reveal is-visible">
        <div className="brand">
          <img className="brand-logo" src="/logo-claw.png" alt={copy.logoAlt} />
          <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="subtext">{copy.subtitle}</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="action ghost"
            type="button"
            onClick={() => setLocale((prev) => (prev === 'en' ? 'zh' : 'en'))}
          >
            {copy.language}
          </button>
          <button className="action" type="button" onClick={openDownloadsFolder}>
            {copy.openDownloads}
          </button>
        </div>
      </header>

      <section
        className={`card-grid reveal ${visibleSections.metrics ? 'is-visible' : ''}`}
        ref={registerSection('metrics')}
        data-section="metrics"
      >
        <article className="metric-card">
          <p className="metric-label">{copy.totalJobs}</p>
          <p className="metric-value">{stats.total}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">{copy.downloading}</p>
          <p className="metric-value">{stats.downloading}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">{copy.done}</p>
          <p className="metric-value">{stats.done}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">{copy.failed}</p>
          <p className="metric-value">{stats.failed}</p>
        </article>
      </section>

      <section
        className={`panel reveal ${visibleSections.new ? 'is-visible' : ''}`}
        ref={registerSection('new')}
        data-section="new"
      >
        <div className="panel-head">
          <h2>{copy.newDownload}</h2>
          <span>{copy.singleLink}</span>
        </div>
        <form className="single-form" onSubmit={createSingleJob}>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={copy.pasteLink}
          />
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            <option value="mp4">{copy.mp4Recommended}</option>
            <option value="original">{copy.originalFormat}</option>
          </select>
          <button type="submit" disabled={isSubmitting}>
            {copy.addJob}
          </button>
        </form>
        {message ? <p className="message">{message}</p> : null}
      </section>

      <section className="two-col">
        <article
          className={`panel reveal ${visibleSections.batch ? 'is-visible' : ''}`}
          ref={registerSection('batch')}
          data-section="batch"
        >
          <div className="panel-head">
            <h2>{copy.batchDownload}</h2>
            <span>{copy.oneUrlPerLine}</span>
          </div>
          <textarea
            className="batch-input"
            value={batch}
            onChange={(event) => setBatch(event.target.value)}
            placeholder={'https://example.com/a\nhttps://example.com/b'}
          />
          <button
            type="button"
            className="secondary-btn"
            onClick={createBatchJobs}
            disabled={isSubmitting}
          >
            {copy.submitBatch}
          </button>
        </article>

        <article
          className={`panel reveal ${visibleSections.status ? 'is-visible' : ''}`}
          ref={registerSection('status')}
          data-section="status"
        >
          <div className="panel-head">
            <h2>{copy.jobStatus}</h2>
            <span>{copy.autoRefresh}</span>
          </div>
          <ul className="activity-list">
            {jobs.map((item) => (
              <li key={item.id}>
                <time>{copy.status[item.status] ?? item.status}</time>
                <div>
                  <p>{item.url}</p>
                  <div className="progress-track">
                    <div
                      className={`progress-fill status-${item.status}`}
                      style={{ width: `${Math.max(item.progress, 2)}%` }}
                    />
                  </div>
                  <small>{item.progress.toFixed(1)}%</small>
                </div>
              </li>
            ))}
            {jobs.length === 0 ? (
              <li>
                <time>{copy.hint}</time>
                <p>{copy.noJobs}</p>
              </li>
            ) : null}
          </ul>
        </article>
      </section>
    </main>
  )
}

export default App
