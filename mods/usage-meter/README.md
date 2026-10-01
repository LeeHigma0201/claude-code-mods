# usage-meter

Shows where the session stands against its limits. It is read-only and never nudges you to wrap up.

- **Status line**, refreshed after every turn and whenever a plan window moves a point:
  `ctx 42% · 5h 81% · 7d 23% · $3.10`. That is context fill, the 5-hour and 7-day plan windows, and session
  cost. Cost is the API-equivalent figure, **not** subscription usage; `/money` owns real spend.
- **Toast** the first time a plan window crosses 80% and 95% (once per window per reset).
- **`/usage-meter`**: the same readings with reset times, as a transcript line. Use this one from the phone
  over Remote Control, where the status line isn't drawn.

Plan windows show only on a subscription, after the first response of the session.

Hooks: `session.start` (registers the command), `session.measure`, `command.run`. Calls: `$.session.usage`,
`$.ui.status`, `$.ui.toast`, `$.clock.now`, `$.command.register`.

Test: `claude plugin test .` (3 tests). Uninstall: see the repo README.
