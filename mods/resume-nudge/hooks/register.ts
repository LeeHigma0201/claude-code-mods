import type { Register, SessionMessage } from 'claude-code'

// Wording taken from real restart recoveries, 2026-09.
export const RESUME_TEXT =
  'The Mac restarted and this session was interrupted. Pick up exactly where you left off and keep going on the original task. Re-check the state of anything that was mid-flight before repeating it.'

// A deliberate Esc leaves this marker; that is a stop, not a cut-off.
const USER_STOP = /^\[Request interrupted by user/

export type Verdict = { isCut: boolean; why: string }

// Was the conversation cut off mid-turn? Reads only the last message.
export function cutOff(messages: SessionMessage[]): Verdict {
  const last = messages.at(-1)
  if (!last) return { isCut: false, why: 'empty conversation' }
  if (last.role === 'assistant') {
    const pending = last.toolUses.filter(t => t.text === undefined)
    return pending.length
      ? { isCut: true, why: `${pending.length} tool call${pending.length === 1 ? '' : 's'} never returned (${pending.map(t => t.tool).join(', ')})` }
      : { isCut: false, why: 'last turn ended with an answer' }
  }
  if (USER_STOP.test(last.text.trim())) return { isCut: false, why: 'stopped on purpose (Esc)' }
  if (last.toolResults?.length) return { isCut: true, why: 'a tool result came back but Claude never answered it' }
  if (last.text.trim()) return { isCut: true, why: 'a prompt was sent but never answered' }
  return { isCut: false, why: 'last message is empty' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'resume-here',
      description: 'Send the pick-up prompt if this session was cut off (`check` only reports)',
      argumentHint: '[check]',
    })
    const verdict = cutOff(await $.session.messages())
    if (verdict.isCut) {
      await $.prompt.fill({ text: RESUME_TEXT })
      $.ui.toast(`resume-nudge: session was cut off (${verdict.why}). Pick-up prompt drafted; Enter to send, or /resume-here.`)
    }
    return next(e)
  })

  on('command.run', { command: 'resume-here' }, async ($, e) => {
    const verdict = cutOff(await $.session.messages())
    if (e.args.trim() === 'check') return { text: `resume-nudge: ${verdict.isCut ? 'cut off' : 'not cut off'} (${verdict.why}).` }
    if (!verdict.isCut) return { text: `resume-nudge: nothing to resume (${verdict.why}). Type your next prompt as usual.` }
    // A submit from inside command.run would wait on the turn this hook holds, so it goes
    // out on a timer once the command has answered.
    $.clock.after(0, () => {
      $.prompt.submit({ text: RESUME_TEXT, asUser: true }).catch(err => $.ui.toast(`resume-nudge: could not send the pick-up prompt: ${String(err)}`))
    })
    return { text: `resume-nudge: sending the pick-up prompt (${verdict.why}).` }
  })
}
