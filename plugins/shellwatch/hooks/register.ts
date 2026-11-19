import type { Register } from 'claude-code'

export type Proc = { pid: number; ppid: number; elapsedSec: number; cpu: string; stat: string; args: string }
export type Shell = { pid: number; elapsedSec: number; cpu: string; stat: string; command: string; descendants: Proc[] }
export type Verdict = { pid: number; reason: string }

// ponytail: etime/time/stat/args exist in both procps and BSD ps (etimes is Linux-only)
export const PS_ARGV = ['ps', '-ww', '-eo', 'pid=,ppid=,etime=,time=,stat=,args=']
const INTERVAL_MS = 300_000
const MIN_AGE_SEC = 600
// any shell started with -c (sh, bash, zsh, dash, ksh, ash, fish...): never assume the user's shell
const SHELL_RE = /^(\S*\/)?(\w*sh|fish)\s+-\S*c\s/

export const parseEtime = (s: string): number => {
  const [days, rest] = s.includes('-') ? s.split('-') : ['0', s]
  return (rest ?? '').split(':').reduce((acc, n) => acc * 60 + Number(n), 0) + Number(days) * 86400
}

export const parsePs = (stdout: string): Proc[] =>
  stdout.split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/)
    if (!m) return []
    const elapsedSec = parseEtime(m[3]!)
    return Number.isNaN(elapsedSec)
      ? []
      : [{ pid: Number(m[1]), ppid: Number(m[2]), elapsedSec, cpu: m[4]!, stat: m[5]!, args: m[6]! }]
  })

// Claude Code wraps each command as `<shell> -c source <snapshot> ... && eval '<command>' < /dev/null && ...`
export const extractCommand = (args: string): string => {
  const m = args.match(/\beval '((?:[^']|'\\'')*)'/)
  return (m ? m[1]!.replaceAll(`'\\''`, `'`) : args).slice(0, 500)
}

export const findShells = (procs: Proc[], minAgeSec: number): Shell[] => {
  const self = procs.find(p => p.args === PS_ARGV.join(' '))
  if (!self) return []
  return procs
    .filter(p => p.ppid === self.ppid && p.pid !== self.pid && SHELL_RE.test(p.args) && p.elapsedSec >= minAgeSec)
    .map(p => {
      const descendants: Proc[] = []
      const queue = [p.pid]
      while (queue.length && descendants.length < 10) {
        const parent = queue.shift()
        for (const c of procs.filter(c => c.ppid === parent)) {
          if (descendants.length < 10) descendants.push({ ...c, args: c.args.slice(0, 300) })
          queue.push(c.pid)
        }
      }
      return { pid: p.pid, elapsedSec: p.elapsedSec, cpu: p.cpu, stat: p.stat, command: extractCommand(p.args), descendants }
    })
}

export const parseVerdicts = (text: string, pids: Set<number>): Verdict[] => {
  try {
    const parsed: unknown = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(v => v?.stuck === true && pids.has(v.pid))
      .map(v => ({ pid: v.pid as number, reason: typeof v.reason === 'string' ? v.reason : '' }))
  } catch {
    return []
  }
}

export const buildReport = (shells: Shell[], verdicts: Verdict[]): string =>
  [
    'shellwatch: these background shells look stuck (judged by Haiku):',
    '',
    ...verdicts.flatMap(v => {
      const s = shells.find(s => s.pid === v.pid)
      return s ? [`- PID ${s.pid}, running ${Math.floor(s.elapsedSec / 60)} min: \`${s.command}\``, `  Why: ${v.reason}`] : []
    }),
    '',
    'For each, decide: kill it (`kill <pid>`), fix what it is waiting on, or leave it if it is meant to run. Reply briefly.',
  ].join('\n')

const JUDGE_SYSTEM = `You check shell processes a coding agent started and left running, to find ones that are stuck.
Input: a JSON array of shells, each with pid, command, elapsedSec, cpu (CPU time used), stat (ps state) and descendants (its child processes now).
Stuck means it can never finish or make progress: it waits on a condition that cannot become true, a grep/pgrep -f that matches its own command line so the loop never ends, polling something that does not exist, or blocked reading input nobody will send.
Not stuck: intentionally long-running work (dev servers, file watchers, tail -f log monitors), builds or tests still using CPU. When unsure, it is not stuck.
Answer ONLY a JSON array: [{"pid": number, "stuck": boolean, "reason": "one line"}], one entry per shell.`

// pids already handed to Claude; module variables reset on reload, so a pid may be re-reported once then
const reported = new Set<number>()
let busy = false
let warned = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const r = await $.process.run(PS_ARGV)
        if (r.exitCode !== 0) throw new Error(`ps exited ${r.exitCode}: ${r.stderr.trim()}`)
        const procs = parsePs(r.stdout)
        // without our own ps row we can't tell which process is Claude: say so instead of going silent
        if (!procs.some(p => p.args === PS_ARGV.join(' '))) throw new Error("can't find its own ps in the process list")
        const shells = findShells(procs, MIN_AGE_SEC).filter(s => !reported.has(s.pid))
        if (!shells.length) return
        const res = await $.model.complete({
          model: 'haiku',
          system: JUDGE_SYSTEM,
          prompt: JSON.stringify(shells),
          maxTokens: 2000,
          timeoutMs: 60_000,
        })
        if (!res.isAnswered) throw new Error(`Haiku did not answer (${res.reason})`)
        const verdicts = parseVerdicts(res.text, new Set(shells.map(s => s.pid)))
        if (!verdicts.length) return
        for (const v of verdicts) reported.add(v.pid)
        void $.prompt.submit({ text: buildReport(shells, verdicts) })
      } catch (err) {
        // a failed tick must not end the interval, but must not be silent either: toast once per session
        if (!warned) void $.ui.toast(`shellwatch check failed: ${err instanceof Error ? err.message : String(err)}`)
        warned = true
      } finally {
        busy = false
      }
    }
    $.clock.every(INTERVAL_MS, tick)
    return next(e)
  })
}
