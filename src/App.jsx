import './App.css'
import { useEffect, useMemo, useState } from 'react'

async function readJsonSafely(response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('后端返回异常，请确认 dev:server 正在运行')
  }
}

function App() {
  const [url, setUrl] = useState('')
  const [batch, setBatch] = useState('')
  const [format, setFormat] = useState('mp4')
  const [jobs, setJobs] = useState([])
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function loadJobs() {
    const response = await fetch('/api/jobs')
    const data = await readJsonSafely(response)
    setJobs(data.jobs ?? [])
  }

  useEffect(() => {
    setTimeout(() => {
      loadJobs().catch(() => {
        setMessage('后端服务未启动，请先运行 npm run dev:server')
      })
    }, 0)
    const timer = setInterval(() => {
      loadJobs().catch(() => {})
    }, 1200)
    return () => clearInterval(timer)
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
      const data = await readJsonSafely(response)
      if (!response.ok) {
        throw new Error(data.error ?? '提交失败')
      }
      setUrl('')
      setMessage(`已加入下载队列：${data.job.url}`)
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
      const data = await readJsonSafely(response)
      if (!response.ok) {
        throw new Error(data.error ?? '批量提交失败')
      }
      setBatch('')
      setMessage(`批量提交成功：${data.jobs.length} 个任务`)
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
      setMessage('打开下载目录失败，请确认后端服务正常')
    }
  }

  return (
    <main className="dashboard">
      <header className="header">
        <div>
          <p className="eyebrow">Video Downloader Dashboard</p>
          <h1>链接下载面板</h1>
          <p className="subtext">仅用于你有版权或授权的视频资源</p>
        </div>
        <button className="action" type="button" onClick={openDownloadsFolder}>
          打开下载目录
        </button>
      </header>

      <section className="card-grid">
        <article className="metric-card">
          <p className="metric-label">总任务</p>
          <p className="metric-value">{stats.total}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">下载中</p>
          <p className="metric-value">{stats.downloading}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">已完成</p>
          <p className="metric-value">{stats.done}</p>
        </article>
        <article className="metric-card">
          <p className="metric-label">失败</p>
          <p className="metric-value">{stats.failed}</p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>新建下载</h2>
          <span>单个链接</span>
        </div>
        <form className="single-form" onSubmit={createSingleJob}>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="粘贴视频链接"
          />
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            <option value="mp4">mp4（推荐）</option>
            <option value="original">原始格式</option>
          </select>
          <button type="submit" disabled={isSubmitting}>
            添加任务
          </button>
        </form>
        {message ? <p className="message">{message}</p> : null}
      </section>

      <section className="two-col">
        <article className="panel">
          <div className="panel-head">
            <h2>批量下载</h2>
            <span>每行一个链接</span>
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
            提交批量任务
          </button>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>任务状态</h2>
            <span>每 1.2 秒刷新</span>
          </div>
          <ul className="activity-list">
            {jobs.map((item) => (
              <li key={item.id}>
                <time>{item.status}</time>
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
                <time>提示</time>
                <p>暂无任务，先贴一个链接试试。</p>
              </li>
            ) : null}
          </ul>
        </article>
      </section>
    </main>
  )
}

export default App
