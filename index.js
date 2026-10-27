/**
 * Windows toast notifications for DeepSeek Harness.
 *
 * Approval requests show a toast with 允许一次 / 拒绝 buttons. Clicking a button
 * activates the registered `dshnotify://` protocol, which calls a small local
 * HTTP endpoint owned by this plugin and settles the approval without bringing
 * DSH to the foreground.
 *
 * Toasts are suppressed only for the conversation currently visible in the
 * foreground window: that session already shows the in-app prompt. Toasts for
 * other conversations still appear, so parallel sessions are not missed. If
 * the toast path cannot answer (foreground skip, missing port, spawn failure)
 * the in-app dialog is composed as the fallback.
 * The two prompts are deliberately NOT shown at the same time: the browser
 * approval panel can only dismiss itself through its own answer or through the
 * tool call's AbortSignal, so answering from the toast while that panel is open
 * would leave a stale prompt on screen.
 *
 * Task completion and errors produce plain informational toasts.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const WSCRIPT = 'C:\\Windows\\System32\\wscript.exe'
const LAUNCH_VBS = join(PLUGIN_DIR, 'notify-launch.vbs')
const DECISION_LAUNCH_VBS = join(PLUGIN_DIR, 'decision-launch.vbs')
const CREATE_NO_WINDOW = 0x08000000
const TOAST_SCRIPT = join(PLUGIN_DIR, 'toast.ps1')
const DECISION_SCRIPT = join(PLUGIN_DIR, 'decision.ps1')
const LOGO_PATH = join(PLUGIN_DIR, 'assets', 'icon.png')
const LOGO_ICO = join(PLUGIN_DIR, 'assets', 'icon.ico')
const HERO_PATH = join(PLUGIN_DIR, 'assets', 'hero.jpg')
const APPROVAL_TIMEOUT_MS = 60000
const TOAST_GAP_MS = 6000
const TOAST_APPROVAL_WAIT_MS = 60000
const TOAST_ADVANCE_GAP_MS = 600
const PROTOCOL = 'dshnotify'
const AUMID = 'DSH.Notify'
function run(file, args) {
  try {
    const child = spawn(file, args, { windowsHide: true, stdio: 'ignore', detached: false, creationFlags: CREATE_NO_WINDOW })
    child.on('error', () => {})
    return child
  } catch {
    return undefined
  }
}

function runPowerShell(args) {
  return run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ...args])
}

/**
 * Run the toast script and report whether it actually displayed a toast.
 * toast.ps1 exits 0 after Show(), 5 when it deliberately skips (DSH in the
 * foreground), and non-zero on any failure; the caller falls back to the
 * in-app dialog whenever the notification path cannot answer.
 */
function psQuote(value) {
  return "'" + String(value ?? '').replace(/'/g, "''") + "'"
}

function toastCommand(args) {
  let command = '& ' + psQuote(TOAST_SCRIPT)
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i]
    if (flag === '-Approval' || flag === '-Remove') {
      command += ' ' + flag
      continue
    }
    command += ' ' + flag + ' ' + psQuote(args[i + 1])
    i += 1
  }
  return command
}

function runToastScript(command, wait) {
  const scriptPath = join(tmpdir(), 'dsh-toast-' + process.pid + '-' + Date.now() + '-' + randomBytes(4).toString('hex') + '.ps1')
  try {
    writeFileSync(scriptPath, '\ufeff' + command + '\n', 'utf8')
  } catch {
    return undefined
  }
  let child
  try {
    child = spawn(WSCRIPT, ['//nologo', '//B', LAUNCH_VBS, scriptPath], {
      windowsHide: true,
      stdio: 'ignore',
      creationFlags: CREATE_NO_WINDOW,
    })
  } catch {
    try { unlinkSync(scriptPath) } catch {}
    return undefined
  }
  const cleanup = () => {
    try { unlinkSync(scriptPath) } catch {}
  }
  child.on('error', cleanup)
  if (!wait) {
    child.on('exit', cleanup)
    child.unref()
    return undefined
  }
  child.on('exit', cleanup)
  return child
}

let toastChain = Promise.resolve()
const toastWaiters = new Map()
const cancelledTags = new Set()

function tagFromArgs(args) {
  const index = args.indexOf('-Tag')
  return index >= 0 ? args[index + 1] : ''
}

function markCancelled(tag) {
  if (!tag) return
  cancelledTags.add(tag)
  const timer = setTimeout(() => cancelledTags.delete(tag), 120000)
  if (timer && typeof timer.unref === 'function') timer.unref()
}

function advanceToast(tag) {
  const waiter = toastWaiters.get(tag)
  if (!waiter) return
  toastWaiters.delete(tag)
  waiter()
}

/**
 * Show toasts one at a time. Windows can otherwise stack or collapse several
 * rapid notifications into the Action Center. Info toasts get a short display
 * gap; approval toasts wait for the user's decision (or the approval timeout)
 * before the next queued toast is shown.
 */
function showToastProcess(args) {
  const tag = tagFromArgs(args)
  const isApproval = args.includes('-Approval')
  const showOne = () =>
    new Promise((resolve) => {
      if (tag && cancelledTags.has(tag)) return resolve(5)
      const child = runToastScript(toastCommand(args), true)
      if (!child) return resolve(-1)
      child.on('error', () => resolve(-1))
      child.on('exit', (code) => {
        const value = code ?? -1
        if (value !== 0) return resolve(value)
        if (tag && cancelledTags.has(tag)) return resolve(value)
        if (!isApproval) {
          setTimeout(() => resolve(value), TOAST_GAP_MS)
          return
        }
        let finished = false
        let timer
        const finish = (delay) => {
          if (finished) return
          finished = true
          if (timer) clearTimeout(timer)
          if (tag) toastWaiters.delete(tag)
          setTimeout(() => resolve(value), delay)
        }
        if (tag) {
          toastWaiters.set(tag, () => finish(TOAST_ADVANCE_GAP_MS))
          timer = setTimeout(() => finish(TOAST_ADVANCE_GAP_MS), TOAST_APPROVAL_WAIT_MS)
        } else {
          setTimeout(() => resolve(value), TOAST_GAP_MS)
        }
      })
    })
  const task = toastChain.then(showOne, showOne)
  toastChain = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}

function registerProtocol() {
  const command =
    `"${WSCRIPT}" //nologo //B "${DECISION_LAUNCH_VBS}" "%1"`
  try {
    run('reg', ['add', `HKCU\\Software\\Classes\\${PROTOCOL}`, '/ve', '/d', 'URL:DSH Notification', '/f'])
    run('reg', ['add', `HKCU\\Software\\Classes\\${PROTOCOL}`, '/v', 'URL Protocol', '/d', '', '/f'])
    run('reg', ['add', `HKCU\\Software\\Classes\\${PROTOCOL}\\shell\\open\\command`, '/ve', '/d', command, '/f'])
    // Windows 11 refuses toasts from processes without a registered AppUserModelId.
    run('reg', ['add', `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`, '/v', 'DisplayName', '/d', 'DeepSeek Harness', '/f'])
    run('reg', ['add', `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`, '/v', 'IconUri', '/d', LOGO_ICO, '/f'])
  } catch {
    // Notifications degrade to plain toasts when the protocol cannot be registered.
  }
}

function showToast({ title, body, allowUri, denyUri, tag, hero, sessionTitle, approval }) {
  const args = ['-Title', title || '', '-Body', body, '-Tag', tag || 'dsh']
  if (hero) args.push('-HeroPath', HERO_PATH)
  if (sessionTitle) args.push('-SessionTitle', sessionTitle)
  if (approval) args.push('-Approval')
  if (allowUri && denyUri) args.push('-AllowUri', allowUri, '-DenyUri', denyUri)
  return showToastProcess(args).then((code) => {
    return code === 0
  })
}

function removeToast(tag) {
  markCancelled(tag)
  advanceToast(tag)
  runToastScript(toastCommand(['-Remove', '-Tag', tag]), false)
}

/**
 * Shorten display copy without cutting a sentence in the middle of a phrase.
 * Preference order: a complete sentence, then a clause boundary (comma,
 * colon, space), and only as the last resort a hard cut at the code-point
 * limit. Counting by code points keeps emoji/surrogate pairs intact.
 */
function truncate(text, limit) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(value)
  if (chars.length <= limit) return value
  const head = chars.slice(0, limit)
  const sentenceEnders = new Set(['。', '！', '？', '!', '?', '；', ';'])
  const minSentence = Math.max(1, Math.floor(limit * 0.4))
  for (let i = head.length - 1; i >= minSentence - 1; i -= 1) {
    if (sentenceEnders.has(head[i])) return head.slice(0, i + 1).join('') + '…'
  }
  const clauseEnders = new Set(['，', ',', '、', '：', ':', ' ', '·', '）', ')', '】', ']'])
  const minClause = Math.max(1, Math.floor(limit * 0.5))
  for (let i = head.length - 1; i >= minClause - 1; i -= 1) {
    if (clauseEnders.has(head[i])) return head.slice(0, i).join('') + '…'
  }
  return head.join('') + '…'
}

function sessionLabel(agent) {
  try {
    const session = agent?.session
    // The durable title is the latest `session/title` event (last wins); the
    // Session object exposes no direct title property. Fold it from the log.
    if (session && typeof session.eventAt === 'function' && typeof session.seq === 'number') {
      for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
        const event = session.eventAt(seq)
        if (event?.type === 'session/title') {
          const title = event.data?.title
          if (typeof title === 'string' && title.trim()) return title.trim().slice(0, 200)
          break
        }
      }
    }
    // Tolerate other runtime shapes (older/newer session objects).
    for (const path of [
      () => agent?.session?.header?.title,
      () => agent?.session?.title,
      () => agent?.session?.header?.name,
    ]) {
      try {
        const value = path()
        if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return ''
}

/**
 * True for sessions created by a subagent (child agent) rather than a normal
 * top-level conversation. Subagent notifications are intentionally silent:
 * their approvals stay in-app and their completion/error toasts are skipped.
 */
function isSubagentSession(agent) {
  try {
    const header = agent && agent.session && agent.session.header
    if (!header) return false
    if (header.origin === 'subagent') return true
    return typeof header.delegationDepth === 'number' && header.delegationDepth > 0
  } catch {
    return false
  }
}

function approvalBody(req) {
  const lines = []
  const label = sessionLabel(req?.agent)
  if (label) lines.push(`会话：${truncate(label, 60)}`)
  lines.push(`工具：${truncate(req?.toolName || '未知工具', 40)}`)
  const reason = req?.displayReason?.zh ?? req?.displayReason?.en ?? req?.reason
  if (reason) lines.push(`内容：${truncate(reason, 160)}`)
  return lines.join('\n')
}

export const name = 'desktop-notify'

export function apply(ctx) {
  const pending = new Map()
  let port = 0
  let listening
  let disposed = false
  const runningAgents = new Set()

  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (url.pathname !== '/decision') {
        response.writeHead(404)
        response.end()
        return
      }
      const token = url.searchParams.get('token') || ''
      const rid = url.searchParams.get('rid') || ''
      const choice = url.searchParams.get('choice') || ''
      const entry = pending.get(token)
      if (!entry || entry.rid !== rid || (choice !== 'allow' && choice !== 'deny')) {
        response.writeHead(410, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('expired')
        return
      }
      pending.delete(token)
      clearTimeout(entry.timer)
      removeToast(entry.tag)
      entry.resolve(choice === 'allow' ? 'allowed-once' : 'rejected')
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('ok')
    } catch {
      try {
        response.writeHead(500)
        response.end()
      } catch {
        /* ignore */
      }
    }
  })

  try {
    server.on('error', () => {})
    server.listen(0, '127.0.0.1')
    listening = new Promise((resolve) => {
      server.once('listening', () => {
        try {
          port = server.address().port
        } catch {
          port = 0
        }
        resolve(port)
      })
      setTimeout(() => resolve(0), 3000)
    })
    registerProtocol()
  } catch {
    port = 0
    listening = Promise.resolve(0)
  }

  function notifyApproval(req) {
    let cancel = () => {}
    const promise = new Promise((resolve) => {
      if (disposed) return resolve(null)
      const token = randomBytes(16).toString('hex')
      const rid = randomBytes(8).toString('hex')
      const tag = `approval-${rid}`
      let timer
      function settle(value) {
        try {
          clearTimeout(timer)
        } catch {
          /* ignore */
        }
        resolve(value)
      }
      function cleanup(value) {
        if (pending.get(token) === entry) pending.delete(token)
        removeToast(tag)
        settle(value)
      }
      const entry = {
        rid,
        tag,
        resolve: (outcome) => settle(outcome),
        timer: undefined,
      }
      cancel = () => cleanup(null)
      entry.timer = setTimeout(() => cleanup(null), APPROVAL_TIMEOUT_MS)
      pending.set(token, entry)
      listening.then((readyPort) => {
        if (!readyPort || disposed) return cleanup(null)
        const base = `dshnotify://decision?port=${readyPort}&rid=${rid}&token=${token}`
        showToast({
          // The toast header already shows the brand name; no extra title text line.
          title: '',
          body: approvalBody(req),
          allowUri: `${base}&choice=allow`,
          denyUri: `${base}&choice=deny`,
          tag,
          hero: false,
          sessionTitle: sessionLabel(req?.agent),
          approval: true,
        }).then((shown) => {
          if (!shown) {
            cleanup(null)
          }
        })
      })
      const signal = req?.signal
      if (signal && typeof signal.addEventListener === 'function') {
        const onAbort = () => cleanup(null)
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
    return { promise, cancel: () => cancel() }
  }

  // Notification-first: the toast answers the request on its own, and the in-app
  // dialog is only composed when the notification path cannot answer (timeout,
  // aborted call, or no listener port). Showing both at once would leave a stale
  // in-app prompt behind whenever the toast won the decision: the browser panel
  // only settles through its own answer or the call's AbortSignal, so a
  // host-side early answer can never dismiss it.
  //
  // The toast script decides whether to appear: when the foreground window is
  // this request's session, the in-app UI already carries the prompt and the
  // toast is skipped; toasts for other sessions still appear.
  ctx.on(
    'approval/request',
    async (req, next) => {
      if (isSubagentSession(req?.agent)) return await next()
      const note = notifyApproval(req)
      let outcome = null
      try {
        outcome = await note.promise
      } catch {
        outcome = null
      }
      if (outcome) {
        return outcome
      }
      return await next()
    },
    { prepend: true },
  )

  ctx.on('agent/status', (payload) => {
    try {
      const agent = payload?.agent
      if (!agent) return
      if (payload.status === 'running') {
        if (!isSubagentSession(agent)) runningAgents.add(agent)
        return
      }
      if (payload.status === 'idle') {
        const wasRunning = runningAgents.delete(agent)
        if (!wasRunning || isSubagentSession(agent)) return
        const label = sessionLabel(agent)
        showToast({
          title: 'DSH 任务完成',
          body: label ? `会话：${truncate(label, 60)}` : '当前会话已完成',
          tag: 'done',
          sessionTitle: label,
        })
      }
    } catch {
      /* ignore */
    }
  })

  ctx.on('agent/error', (payload) => {
    try {
      if (isSubagentSession(payload?.agent)) return
      const message = payload?.error?.message ?? payload?.error ?? '未知错误'
      showToast({
        title: 'DSH 出错了',
        body: truncate(message, 180),
        tag: 'error',
        sessionTitle: payload?.agent ? sessionLabel(payload.agent) : '',
      })
    } catch {
      /* ignore */
    }
  })

  ctx.effect(() => () => {
    disposed = true
    for (const [, entry] of pending) {
      try {
        clearTimeout(entry.timer)
      } catch {
        /* ignore */
      }
    }
    pending.clear()
    try {
      server.close()
    } catch {
      /* ignore */
    }
  }, 'desktop-notify: lifetime')
}
