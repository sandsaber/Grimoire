/** Runs in the CLI process, before the CLI is imported. Keep this module self-contained. */
export const COMMANDCODE_APPROVAL_GUARD = String.raw`
import { connect } from 'node:net';
const key = Symbol.for('grimoire.commandcode.approvals');
export function install(config) {
  const state = { registered: false, permits: new Set(), config };
  globalThis[key] = state;
  const write = process.stdout.write.bind(process.stdout);
  let pending = '';
  const stop = () => { process.stderr.write('Command Code approval guard failed.\n'); process.exit(1); };
  process.stdout.write = function(chunk, ...args) {
    pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (pending.length > 16 * 1024 * 1024) stop();
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (!line.trim()) continue;
      let frame;
      try { frame = JSON.parse(line); } catch { stop(); }
      const event = frame?.type === 'event' ? frame.event : undefined;
      if (event?.type === 'run_start' && !state.registered) stop();
      // The CLI emits this synchronously BEFORE invoking the tool runner. A skipped
      // or throwing hook cannot accidentally turn Safe into bypass mode.
      if (event?.type === 'tool_running' && !state.permits.delete(event.toolCallId)) stop();
    }
    return write(chunk, ...args);
  };
}

export default function(cmd) {
  const state = globalThis[key];
  if (!state || typeof cmd.hooks !== 'function') process.exit(1);
  const reads = new Set(['read_file', 'grep', 'glob', 'web_search', 'web_fetch']);
  let approvals = Promise.resolve(false);
  cmd.hooks({ beforeToolCall: async (call, context) => {
    const blocked = { block: true, additionalContext: 'The user did not approve this tool call. Do not retry it.' };
    try {
      if (context?.signal?.aborted) return blocked;
      // Native subagents have their own loop without the parent mod's hooks.
      if (call.toolName === 'agent') return { ...blocked, additionalContext: 'Subagents are unavailable in Safe mode.' };
      let allowed = reads.has(call.toolName);
      if (!allowed) {
        // The native loop executes a tool batch in parallel; the shared decision
        // surface shows one question at a time.
        const answer = approvals.then(() => request(state.config, call, context?.signal));
        approvals = answer.catch(() => false);
        allowed = await answer;
      }
      if (!allowed || context?.signal?.aborted) return blocked;
      state.permits.add(call.toolCallId);
      return undefined;
    } catch { return blocked; }
  }});
  if (state.config.effort) cmd.setEffort(state.config.effort);
  state.registered = true;
}

function request(config, call, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false, buffer = '';
    const socket = connect(config.address);
    const finish = allowed => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      socket.destroy(); resolve(allowed === true);
    };
    const cancel = () => finish(false);
    const timer = setTimeout(cancel, 25 * 60_000);
    signal?.addEventListener('abort', cancel, { once: true });
    socket.on('error', cancel); socket.on('close', cancel);
    socket.on('connect', () => {
      if (signal?.aborted) return cancel();
      socket.write(JSON.stringify({ token: config.token, toolCallId: call.toolCallId,
        toolName: call.toolName, input: call.input }) + '\n');
    });
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 1024) return cancel();
      if (!buffer.includes('\n')) return;
      try { finish(JSON.parse(buffer.trim()).allow === true); } catch { cancel(); }
    });
  });
}
`;
