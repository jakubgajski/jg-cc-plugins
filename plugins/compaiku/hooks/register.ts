import type { Register, SessionMessage } from 'claude-code'

// ponytail: Haiku writes the summary itself, so the session model/effort are never touched
// true from /compaiku until its /compact is answered: marks the next manual main-thread compaction as ours
let compacting = false
const PREFIX = 'This session is being continued from an earlier conversation that was compacted. Summary (written by Haiku):'

const render = (m: SessionMessage) =>
  [
    m.text && `${m.role.toUpperCase()}: ${m.text}`,
    ...m.toolUses.map(t => `TOOL CALL ${t.tool}: ${JSON.stringify(t.input)}`),
    ...(m.toolResults ?? []).map(r => `TOOL RESULT${r.isError ? ' (error)' : ''}: ${r.text}`),
  ]
    .filter(Boolean)
    .join('\n')

const SYSTEM = `You write the handoff that lets a coding assistant pick up this conversation and keep working, after its history is dropped.
Optimize for one thing: the assistant can take the most probable next steps immediately, without re-reading files or asking the user.
Start with: Next steps: the most likely next actions, in order, each with exactly what is needed to do it (paths, commands, snippets, open questions).
Then: Current state: what was just being done and where it stands, what is verified vs. unverified.
Then only the context those steps depend on: the user's goal and constraints, decisions made and why, approaches already tried and rejected, exact error text still relevant, file paths and code that will be touched.
Quote the user's own wording where it sets requirements or preferences.
Drop anything finished and irrelevant to what comes next.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'compaiku',
      description: 'Compact with Haiku (optional instructions), keeping your model and effort',
    })
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    if (!compacting || e.agentId || e.trigger !== 'manual') return next(e)
    compacting = false
    const transcript = e.messages.map(render).join('\n\n')
    const r = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: `${e.instructions ? `Extra instructions: ${e.instructions}\n\n` : ''}<conversation>\n${transcript}\n</conversation>`,
      maxTokens: 8000,
    })
    if (!r.isAnswered) {
      void $.ui.toast(`Haiku summary failed (${r.reason}), compaction skipped`)
      return { skip: `Haiku summary failed (${r.reason})` }
    }
    void $.ui.toast('compacted with Haiku')
    return {
      messages: [
        {
          role: 'user',
          text: `${PREFIX}\n\n${r.text}`,
          toolUses: [],
        },
      ],
    }
  })

  // ponytail: a hook-built summary has no engine compact-summary flag, so it draws as a plain prompt;
  // fold it to one line like the built-in row (ctrl+o still shows it whole)
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) =>
    !e.props.isExpanded && e.props.text.startsWith(PREFIX)
      ? next({ ...e, props: { ...e.props, text: 'Compacted with Haiku (ctrl+o to see full summary)' } })
      : next(e),
  )

  on('command.run', { command: 'compaiku' }, async ($, e) => {
    if (compacting) return { text: 'already compacting with Haiku' }
    compacting = true
    // ponytail: a timer-made $.session.compact skips this mod's own hooks, so queue the built-in
    // /compact instead; it runs once idle and our session.compact hook answers it with Haiku
    // ponytail: queueing /compact inside this hook is refused (it holds the turn), so do it right after
    $.clock.after(0, () => {
      $.command.run({ command: 'compact', args: e.args }).then(
        () => {
          if (compacting) void $.ui.toast('compacted, but NOT by Haiku (hook bypassed)')
          compacting = false
        },
        err => {
          compacting = false
          const msg = err instanceof Error ? err.message : String(err)
          void $.ui.toast(`compaiku failed: ${msg}`)
        },
      )
    })
    return { text: 'compacting with Haiku…' }
  })
}
