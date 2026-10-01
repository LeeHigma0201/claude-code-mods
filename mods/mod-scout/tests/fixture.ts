import type { Scan } from '../hooks/analyze'

// A scan shaped like a real two-week one, with every signal the analyzer reads.
export const scan: Scan = {
  generatedAt: '2026-10-01T19:00:00.000Z',
  days: 14,
  sessionsScanned: 120,
  prompts: {
    total: 800,
    clusters: [
      { key: 'do not use any tools list', count: 21, sessions: 21, solo: 21, example: 'Do not use any tools. List every CANARY_* name.', gate: false },
      { key: 'the mac restarted and this session', count: 7, sessions: 7, solo: 0, example: 'The Mac restarted and this session was interrupted.', gate: false },
      { key: 'push this and deploy to prod', count: 6, sessions: 4, example: 'push this and deploy to prod', gate: true },
      { key: 'status of your progress claude list', count: 3, sessions: 3, example: 'Status of your progress', gate: false },
      { key: 'one off thing', count: 2, sessions: 1, example: '', gate: false },
    ],
    openings: [
      { key: 'do not use any tools list', count: 21, sessions: 21, solo: 21, example: 'Do not use any tools. List every CANARY_* name.', gate: false },
      { key: 'read resume here md and continue', count: 9, sessions: 9, solo: 0, example: 'Read RESUME-HERE.md and continue', gate: false },
    ],
  },
  followups: { verify: 57, correction: 9, verifyExamples: ['did you verify it is live?'], correctionExamples: ['no, that is the wrong file'] },
  tools: {
    byName: { Bash: { calls: 5000, errors: 300 }, Edit: { calls: 900, errors: 20 }, WebFetch: { calls: 40, errors: 14 } },
    bashFamilies: { 'pnpm typecheck': 165, 'pnpm vitest': 131, 'git push': 60, 'vercel --prod': 25, curl: 280, 'git status': 269 },
  },
  denials: { permission: 261, hookBlock: 18, byTool: { Bash: 182, 'mcp__claude-in-chrome__browser_batch': 24, Edit: 12 } },
  sessions: { interrupted: 50, cutOff: 10, compactions: 494, continuedFromSummary: 0, remoteControl: 17, usageLimitHits: 7, modelSwitches: 156, long: 1, withSubagents: 49, slashCommands: { model: 85, loop: 57, compact: 9 } },
  models: { 'claude-opus-5-5': 16628, 'claude-fable-5-1': 12472, 'claude-sonnet-5-5': 1627 },
  projects: [{ name: 'Users/me/dev/web-app', sessions: 30, prompts: 200 }],
}
