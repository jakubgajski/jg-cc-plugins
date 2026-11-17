# compaiku

`/compaiku [instructions]` compacts the conversation with Haiku instead of your session model. Your `/model` and `/effort` stay as they are.

- The summary is written to let the assistant continue with the most likely next steps: next steps first, then current state, then only the context those steps need.
- Optional instructions are passed to Haiku, e.g. `/compaiku focus on the failing test`.
- The summary row is drawn collapsed in the transcript; ctrl+o shows it in full.
- If Haiku fails, compaction is skipped and nothing is lost.

## Install

```
/plugin install compaiku --marketplace jakubgajski/jg-cc-plugins
```

From a shell: `claude plugin install compaiku --marketplace jakubgajski/jg-cc-plugins`
