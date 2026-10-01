---
name: design-mods
description: Turn a mod-scout report (~/.claude/mod-scout/report-<date>.md) into designed, gated, buildable Claude Code mods. Use after /mod-scout design, when someone asks "what mods should I build", "what would a mod fix for me", or wants to audit how they use Claude Code for automation opportunities. Designs first, asks before building, builds with the plugin-authoring skill.
---

# design-mods: from usage evidence to a mod worth keeping

You are reading a report that `/mod-scout` wrote from the person's own session transcripts. Your job is to
turn its candidates into mods that are **worth having and safe to run**, or to say plainly that a candidate
should not be a mod. Design first. Ask before building.

## 1. Read the report, not your memory

- Open the report path given in the prompt. Read "Mod candidates", "Designs" and "Signals". The raw JSON
  path in its first lines holds the counts if you need more.
- Every claim you make about the person's habits must cite a number from the report ("57 verify
  follow-ups in 302 sessions"). No count, no claim.
- Prompt examples in the report are 110-character snippets of the person's own words. Quote them only
  back to the person; never paste them into a mod, a README or anything that could be shared.

## 2. Decide the container before the design

A mod is the right container only when the feature needs at least one of:

| Needs | Why only a mod can do it |
|---|---|
| State shared across events (count, ledger, last result) | A settings hook is a fresh process per event |
| Something drawn live (status line, band, pane, toast, a line under the permission dialog) | Hooks and skills can't draw |
| A `/command` that runs at once, with no Claude turn | Skills start a turn |
| Stepping into a tool call or prompt in-process (annotate, rewrite, answer) | Hooks can block/allow but not draw or keep context |

Otherwise choose the cheaper container and say so:
- **Settings hook**: one script, one event, block/allow/log. Already have one that enforces the rule? Keep it.
  A rule enforced in two places is a rule with a gap between them.
- **Skill**: "I keep pasting the same instructions." Corrections ("no, wrong, still broken") are a skill or
  CLAUDE.md problem, not a mod problem.
- **Scheduled task**: anything that must run when no session is open. A mod's timers die with the session.
- **Not a mod**: starting sessions, trust prompts, the permission dialog's content, anything before the mod loads.

## 3. Score honestly

`value` (1–3): how often it happens × how much it costs when it goes wrong.
`reliability` (1–3): how deterministic the signal → fix is. A regex over a Bash command is 3; guessing intent
from prose is 1. Report `value × reliability`; a 9 is rare.

## 4. Gates are part of the design, not a footnote

If the candidate touches **money, public posting or outreach, legal or case data, credentials, or
production pushes/deploys**, the mod may only:
- **annotate** (`$.ui.notice` under the dialog, `$.ui.status`, a toast),
- **draft** (`$.prompt.fill`, a file the person opens),
- **ask** (a `/command` the person runs; `$.prompt.submit` only from an explicit command, and on
  `$.clock.after`, never inside `command.run`).

It must never return `{ result }` or approve a `tool.call`, never send, post, pay or push, and never read
or display a secret. Write the gate into the README and into a test that proves the mod does not call the
forbidden API (a stub for `prompt.submit` / `process.run` that counts calls and expects 0).

Legal or case material: keep it out of any report that might be shared (`examples` off, project excluded),
and prefer a git pre-commit hook in that repo over a mod, so every tool is covered, not just Claude.

## 5. Write the spec (one per candidate, in this order)

1. **Name** (letters, digits, `-`), one-line purpose.
2. **Evidence**: the report's numbers.
3. **Container** and why (table above).
4. **Hooks**: each event with its matcher, and whether the hook observes, rewrites or answers.
5. **API calls**: the `$` methods, with limits that matter (10 s per hook, 4 MiB per file, 4 MiB store,
   `process.run` 30 s default / 10 min max, panes don't draw on Remote Control).
6. **State**: module variable (lost on reload), `$.state` (session), `$.store` (across sessions). Pick the
   smallest that works.
7. **Gate** (section 4) or "none: read-only".
8. **Failure modes**: what happens when the tool it watches isn't there, the command fails, the pane can't
   be placed, the person is on a phone. Each one degrades to a text line or does nothing. Nothing throws
   into the person's turn.
9. **Tests**: at least one `claude plugin test` case per hook, one for the gate, one for the degraded path.
10. **Uninstall**: one command, nothing left behind. No settings, permissions or hooks of the person's are
    changed by install.

Then **stop and ask** which to build, with the ranked list and your recommendation. Do not build on your
own initiative.

## 6. Build (after the yes)

- Load the `plugin-authoring` skill and follow its layout: `.claude-plugin/plugin.json`, `hooks/hooks.json`,
  `hooks/register.ts(x)`, `tests/*.test.ts`, `README.md`. Give every mod a `/command` text form so it
  works from Remote Control.
- `claude plugin validate --strict <dir>` must pass; read its `hooks:` and `calls:` lines back against the
  spec. A call that isn't in the spec is a bug or a scope creep.
- `claude plugin test <dir>` must pass. Then one live run: `claude -p "/<command>" --plugin-dir <dir>`.
- Report status with one word from: recommended / implemented locally / tested / published. "Tested" needs
  the validate, the tests and the live run. Say what remains unverified.

## 7. Keep the loop honest

After the mods have been in use for a week, run `/mod-scout` again. A candidate that is still at the top
means the mod didn't take; find out why before adding another one.
