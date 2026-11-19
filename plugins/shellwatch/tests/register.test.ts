import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PS_ARGV, parseEtime, parsePs, extractCommand, findShells, parseVerdicts, buildReport } from '../hooks/register.ts'

const SELF = PS_ARGV.join(' ')
const wrap = (cmd: string, sh = '/bin/zsh') =>
  `${sh} -c source /home/u/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && eval '${cmd}' < /dev/null && pwd -P >| /tmp/claude-ab-cwd`
const ps = [
  `  100     1  1-00:00:00 00:01:00 Sl+  claude`,
  `  200   100       20:00 00:00:00 Ss   ${wrap('until pgrep -f myserver; do sleep 5; done')}`,
  `  201   200       00:01 00:00:00 S    sleep 5`,
  `  210   100       15:00 00:00:00 Ss   ${wrap('tail -f log', '/usr/bin/bash')}`,
  `  220   100       12:00 00:00:00 Ss   ${wrap('sleep 999', 'ksh')}`,
  `  300   100       03:00 00:00:00 Ss   ${wrap('npm test')}`,
  `  400   100       30:00 00:00:00 Sl   railway mcp`,
  `  500   100       00:00 00:00:00 R    ${SELF}`,
  `  600     1       40:00 00:00:00 Ss   /bin/bash -c sleep 9999`,
  `garbage line`,
].join('\n')

test('parseEtime', () => {
  assert.equal(parseEtime('05:06'), 306)
  assert.equal(parseEtime('02:03:04'), 7384)
  assert.equal(parseEtime('1-02:03:04'), 93784)
})

test('parsePs skips malformed lines', () => {
  const procs = parsePs(ps)
  assert.equal(procs.length, 9)
  assert.deepEqual(procs[2], { pid: 201, ppid: 200, elapsedSec: 1, cpu: '00:00:00', stat: 'S', args: 'sleep 5' })
})

test('extractCommand unwraps and unescapes quotes', () => {
  assert.equal(extractCommand(wrap(`echo '\\''hi'\\''`)), `echo 'hi'`)
  assert.equal(extractCommand('/bin/bash -c sleep 9999'), '/bin/bash -c sleep 9999')
})

test('findShells keeps only old shell children of claude, any shell', () => {
  const shells = findShells(parsePs(ps), 600)
  assert.deepEqual(shells.map(s => s.pid), [200, 210, 220])
  assert.equal(shells[0]!.command, 'until pgrep -f myserver; do sleep 5; done')
  assert.deepEqual(shells[0]!.descendants.map(d => d.pid), [201])
})

test('findShells returns [] without its own ps row', () => {
  assert.deepEqual(findShells(parsePs(ps.replace(SELF, 'ps aux')), 600), [])
})

test('parseVerdicts tolerates prose around JSON', () => {
  const text = 'Sure:\n[{"pid":200,"stuck":true,"reason":"pgrep matches itself"},{"pid":300,"stuck":false,"reason":"ok"}]\nDone.'
  assert.deepEqual(parseVerdicts(text, new Set([200, 300])), [{ pid: 200, reason: 'pgrep matches itself' }])
})

test('parseVerdicts ignores unknown pids', () => {
  assert.deepEqual(parseVerdicts('[{"pid":999,"stuck":true,"reason":"x"}]', new Set([200])), [])
})

test('parseVerdicts junk', () => {
  assert.deepEqual(parseVerdicts('no idea', new Set([200])), [])
  assert.deepEqual(parseVerdicts('[{"pid":', new Set([200])), [])
})

test('buildReport names pid, command, age and reason', () => {
  const [shell] = findShells(parsePs(ps), 600) // pid 200
  const text = buildReport([shell!], [{ pid: 200, reason: 'pgrep matches itself' }])
  for (const s of ['200', 'until pgrep -f myserver', '20 min', 'pgrep matches itself', 'kill']) assert.ok(text.includes(s), s)
})
