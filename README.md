# claude-code-mods

Four small [Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/) (Claude Code 2.1.287+),
served from this repo as a plugin marketplace named `claude-code-mods`. Each mod is read-only on your setup:
none changes a setting, a permission or a hook, and none sends anything off your machine.

| Mod | What you get | Touches |
|---|---|---|
| [`mod-scout`](mods/mod-scout) | `/mod-scout` scans your last 14 days of transcripts and ranks the mods *you* would use most, with the gate each needs; `/mod-scout design 3` hands the report to Claude with the bundled `design-mods` skill, which specs them and asks before building | reads transcripts; writes `~/.claude/mod-scout/` |
| [`usage-meter`](mods/usage-meter) | Status line `ctx 42% · 5h 81% · 7d 23% · $3.10`; a toast at 80% and 95% of a plan window; `/usage-meter` | read-only |
| [`check-ledger`](mods/check-ledger) | Status line `✓ pnpm run typecheck · 2 files unchecked`; `/evidence`; an `evidence` tool Claude reads before saying "tested" | read-only |
| [`resume-nudge`](mods/resume-nudge) | After a restart cuts a turn off, drafts the pick-up prompt (Enter to send); `/resume-here` | drafts; sends only on `/resume-here` |

`mod-scout` is how the other three were chosen: it is the usage audit as a mod. Run it first; it will tell you
which of the others (or something else) is worth installing for how you actually work.

## Install (reversible)

```bash
claude plugin marketplace add LeeHigma0201/claude-code-mods
claude plugin install mod-scout@claude-code-mods --config exclude=private-project
claude plugin install usage-meter@claude-code-mods
claude plugin install check-ledger@claude-code-mods
claude plugin install resume-nudge@claude-code-mods
```

New sessions load them; in an open session run `/reload-plugins`. Install only the ones you want.

**Try one without installing** (this session only): clone the repo and run `claude --plugin-dir ./mods/mod-scout`.

## Uninstall

```bash
claude plugin uninstall mod-scout@claude-code-mods
claude plugin uninstall usage-meter@claude-code-mods
claude plugin uninstall check-ledger@claude-code-mods
claude plugin uninstall resume-nudge@claude-code-mods
claude plugin marketplace remove claude-code-mods
```

Or disable one in `/plugin` → **Installed**; for one session, `claude --safe-mode`. Uninstalling leaves nothing behind
except `~/.claude/mod-scout/` reports, which you can delete.

## Privacy

`mod-scout` reads your own transcripts under `~/.claude/projects` and writes a report that quotes short prompt
snippets (turn `examples` off, and `exclude` private projects, before sharing a report). Share the mod, not your
report. Nothing leaves the machine; no mod here approves a tool call, sends, posts or pays.

## Checks

```bash
scripts/smoke.sh            # claude plugin validate --strict + claude plugin test, every mod
scripts/smoke.sh mod-scout
```

Each mod's README says what it hooks, what it calls on `$`, and how it was tested.

## License

MIT.
