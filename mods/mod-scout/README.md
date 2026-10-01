# mod-scout

A Claude Code mod that reads how you actually use Claude Code and tells you which mods you'd use most.
Then it hands Claude a skill that knows how to design and build them.

```
/mod-scout
mod-scout: 302 sessions, 1,201 prompts, 14 days. 11 candidates. Report: ~/.claude/mod-scout/report-2026-10-01.md
1. [9] Check ledger: which tests/type-checks ran, which edits came after  (mod; 57 verify-style follow-ups; 440 test/typecheck/build commands)
2. [9] Usage meter: context %, 5h/7d plan windows, cost  (mod; 7 usage-limit mentions, 494 compactions)
3. [6] Pre-flight note on tool calls that keep getting denied  (mod; 261 permission denials, 18 hook blocks)
...
/mod-scout design 3
```

## What it does

1. **Scans** your transcripts in `~/.claude/projects` (last 14 days by default) with a bundled Node script.
   It streams each file, skips subagent transcripts, and keeps only aggregate counts: prompts you type again
   and again, how sessions end, verify-style and correction follow-ups, permission denials by tool, Bash
   command families (`git push`, `pnpm typecheck`, `curl`…), compactions, model switches, slash commands.
2. **Scores** each signal against a catalog of mod shapes and ranks them by value × reliability. It also
   says which candidates should **not** be mods (a skill, a settings hook, a scheduled task) and flags any
   that touch money, posting, legal data or production deploys, with the gate the design must keep.
3. **Writes** `~/.claude/mod-scout/report-<date>.md` and opens a pane with the ranked list.
4. **`/mod-scout design 3`** sends Claude one prompt: use the bundled `design-mods` skill on the report,
   design the top three, and ask before building. The skill (`/mod-scout:design-mods`, in `skills/design-mods/SKILL.md`) holds the
   container test, the scoring rubric, the gate rules, the spec template, and the build checklist.

Nothing leaves the machine. The scanner reads transcripts; the mod writes only under `~/.claude/mod-scout`.

## Commands

| Command | Does |
|---|---|
| `/mod-scout` | Scan, write the report, open the pane |
| `/mod-scout show` | Reopen the pane from the last scan |
| `/mod-scout design <n>` | Ask Claude to design the top n with the skill (asks before building) |
| `/mod-scout help` | Usage |

The pane isn't drawn on Remote Control; the command's text reply carries the top five, and the report has
the rest.

## Options

Set them in `/plugin configure mod-scout@claude-code-mods` or `--config` on install:

| Option | Default | Use |
|---|---|---|
| `days` | 14 | How far back to scan |
| `exclude` | "" | Comma-separated project path substrings to skip, e.g. `private-project,client-x` |
| `examples` | true | Keep 110-character prompt snippets in the report. Turn off before sharing a report |

`MOD_SCOUT_DIR` in the environment moves the output directory.

## Privacy

The report is about you. Snippets of your prompts appear in it when `examples` is on. Exclude private
projects, turn examples off for anything you'll share, and share the mod, not your report.

## Requirements

Claude Code 2.1.287+, Node 18+ on `PATH` (the scanner). The scan of 2.3 GB of transcripts took 7 s on an M4.

## Install / uninstall

```bash
claude plugin marketplace add LeeHigma0201/claude-code-mods
claude plugin install mod-scout@claude-code-mods --config exclude=private-project
# remove:
claude plugin uninstall mod-scout@claude-code-mods
```

Try without installing: `claude --plugin-dir ./mods/mod-scout`.

## How it's built

- `scripts/scan.mjs`: facts only. Streams JSONL, no dependencies.
- `hooks/analyze.ts`: pure functions, scan → candidates → report. Tested on a fixture.
- `hooks/register.tsx`: `session.start` (registers the command, restores the last scan from `$.store`),
  `command.run`, `ui.render` for the pane. Calls: `$.process.run`, `$.fs.read/write`, `$.store`,
  `$.env.get`, `$.ui.open/toast`, `$.prompt.submit` (only from `design`, on `$.clock.after`).
- `tests/`: `claude plugin test .` (6 tests): ranking and gating, report content, the scan command end to
  end with stubs, options, scanner failure, and that `help`/`show` never submit while `design` submits once.

Hooks and limits: a hook has 10 s of its own time; `process.run` is capped at 10 min; `fs.read` at 4 MiB
(the scanner caps its JSON well under that).
