# shellwatch

Every 5 minutes, shellwatch looks at the shells this Claude Code session started and asks Haiku whether the long-running ones are stuck: a loop waiting for something that will never happen, a `grep`/`pgrep -f` that matches its own command line, a poll on something that does not exist. Stuck ones are handed to Claude in the main session, which decides whether to kill them, fix what they wait on, or leave them.

- Only shells older than 10 minutes, and only this session's (direct children of its `claude` process), whatever shell your system uses.
- Haiku judges; servers, watchers and builds still using CPU count as fine. When unsure, it says fine.
- Each PID is reported once.
- It never kills anything itself.
- Linux and macOS.

## Install

```
/plugin install shellwatch --marketplace jakubgajski/jg-cc-plugins
```

From a shell: `claude plugin install shellwatch --marketplace jakubgajski/jg-cc-plugins`
