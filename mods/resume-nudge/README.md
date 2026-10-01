# resume-nudge

When a session reopens after a restart or crash cut a turn off, this drafts the standard pick-up prompt
in the prompt box: "The Mac restarted and this session was interrupted. Pick up exactly where you left off…".
Press Enter to send it, or ignore it.

It treats the session as **cut off** when the last message is one of:
- a tool call that never returned,
- a tool result Claude never answered,
- a prompt Claude never answered.

It is **not** cut off when the turn ended with an answer, or when you pressed Esc (`[Request interrupted by user]`).

- **`/resume-here`** sends the pick-up prompt, only when the session is cut off. Use it from the phone, where
  the drafted text may not show.
- **`/resume-here check`** reports the verdict and never sends.

It never sends on its own. `session.start` does not fire after an in-session `/resume`; use `/resume-here`
there.

Hooks: `session.start`, `command.run`. Calls: `$.session.messages`, `$.prompt.fill`, `$.prompt.submit`
(only from `/resume-here`, on a timer once the command has answered), `$.ui.toast`, `$.command.register`.

Test: `claude plugin test .` (4 tests).
