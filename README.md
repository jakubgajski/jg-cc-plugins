# jg-cc-plugins

Claude Code plugins (mods).

| Plugin | What it does |
|---|---|
| [compaiku](plugins/compaiku) | `/compaiku [instructions]`: compact the conversation with Haiku, keeping your model and effort |
| [shellwatch](plugins/shellwatch) | Every 5 minutes, asks Haiku whether this session's long-running shells are stuck and hands the stuck ones to Claude |

## Install

At the prompt of a terminal session:

```
/plugin install <plugin> --marketplace jakubgajski/jg-cc-plugins
```

From a shell:

```
claude plugin install <plugin> --marketplace jakubgajski/jg-cc-plugins
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `jakubgajski/jg-cc-plugins`, then Add plugin.
