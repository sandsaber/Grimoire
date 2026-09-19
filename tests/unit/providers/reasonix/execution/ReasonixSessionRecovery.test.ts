import type { ManagedAcpClient, ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpSessionNotification } from '@/providers/acp/types';
import type { ReasonixExecutionRequests } from '@/providers/reasonix/execution/ReasonixExecutionRequests';
import { withReasonixSessionRecovery } from '@/providers/reasonix/execution/ReasonixSessionRecovery';

async function harness() {
  const listeners = new Set<(event: AcpSessionNotification) => void>();
  const load = jest.fn(async () => ({}));
  const prompt = jest.fn(async () => ({ stopReason: 'end_turn' }));
  const recoveryPrompt = jest.fn(() => [{ type: 'text', text: 'Saved conversation' }]);
  const releaseRecoveryPrompt = jest.fn();
  const client = {
    loadSession: load, prompt,
    onSessionNotification: (listener: (event: AcpSessionNotification) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  } as unknown as ManagedAcpClient;
  const factory = { create: async () => client } as ManagedAcpClientFactory;
  await withReasonixSessionRecovery(factory, {
    recoveryPrompt, releaseRecoveryPrompt,
  } as unknown as ReasonixExecutionRequests).create({} as never);
  return { client, load, prompt, recoveryPrompt, releaseRecoveryPrompt, listeners };
}

const loadRequest = { sessionId: 'saved', cwd: '/vault', mcpServers: [] };
const promptRequest = { sessionId: 'saved', messageId: 'turn-1', prompt: [{ type: 'text' as const, text: 'Continue' }] };

describe('Reasonix session recovery', () => {
  it('ignores replay from another session and retains recovery after a rejected prompt', async () => {
    const h = await harness();
    h.load.mockImplementation(async () => {
      for (const listener of h.listeners) listener({ sessionId: 'another', update: {
        sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Unrelated' },
      } });
      return {};
    });
    await h.client.loadSession(loadRequest);
    expect(h.listeners.size).toBe(0);
    h.prompt.mockRejectedValueOnce(new Error('Transport disconnected'));
    await expect(h.client.prompt(promptRequest)).rejects.toThrow('Transport disconnected');
    expect(h.releaseRecoveryPrompt).not.toHaveBeenCalled();
    await h.client.prompt(promptRequest);
    expect(h.prompt).toHaveBeenLastCalledWith({ ...promptRequest, prompt: [{ type: 'text', text: 'Saved conversation' }] });
    expect(h.releaseRecoveryPrompt).toHaveBeenCalledWith('turn-1');
    await h.client.prompt({ ...promptRequest, messageId: 'turn-2' });
    expect(h.prompt).toHaveBeenLastCalledWith({ ...promptRequest, messageId: 'turn-2' });
  });

  it('propagates load errors and removes the replay listener', async () => {
    const h = await harness();
    h.load.mockRejectedValueOnce(new Error('Session locked'));
    await expect(h.client.loadSession(loadRequest)).rejects.toThrow('Session locked');
    expect(h.listeners.size).toBe(0);
    expect(h.prompt).not.toHaveBeenCalled();
    expect(h.recoveryPrompt).not.toHaveBeenCalled();
  });

  it('keeps a successfully replayed native conversation unchanged', async () => {
    const h = await harness();
    h.load.mockImplementation(async () => {
      for (const listener of h.listeners) listener({ sessionId: 'saved', update: {
        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Earlier answer' },
      } });
      return {};
    });
    await h.client.loadSession(loadRequest);
    await h.client.prompt(promptRequest);
    expect(h.prompt).toHaveBeenCalledWith(promptRequest);
    expect(h.recoveryPrompt).not.toHaveBeenCalled();
  });
});
