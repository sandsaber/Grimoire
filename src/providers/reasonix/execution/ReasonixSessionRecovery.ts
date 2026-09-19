import type { ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';

import type { ReasonixExecutionRequests } from './ReasonixExecutionRequests';

/** Reasonix 1.38.10 can acknowledge a saved ACP id while loading an empty controller. */
export function withReasonixSessionRecovery(
  factory: ManagedAcpClientFactory,
  requests: ReasonixExecutionRequests,
): ManagedAcpClientFactory {
  return {
    dispose: () => factory.dispose?.() ?? Promise.resolve('confirmed'),
    create: async input => {
      const client = await factory.create(input);
      const loadSession = client.loadSession.bind(client);
      const prompt = client.prompt.bind(client);
      const emptySessions = new Set<string>();

      client.loadSession = async request => {
        let replayed = false;
        const unsubscribe = client.onSessionNotification(notification => {
          if (notification.sessionId === request.sessionId
            && (notification.update.sessionUpdate === 'user_message_chunk'
              || notification.update.sessionUpdate === 'agent_message_chunk')) {
            replayed = true;
          }
        });
        try {
          const response = await loadSession(request);
          if (replayed) emptySessions.delete(request.sessionId);
          else emptySessions.add(request.sessionId);
          return response;
        } finally {
          unsubscribe();
        }
      };

      client.prompt = async request => {
        const recovery = emptySessions.has(request.sessionId) && request.messageId
          ? requests.recoveryPrompt(request.messageId)
          : undefined;
        const response = await prompt(recovery ? { ...request, prompt: [...recovery] } : request);
        // A rejected dispatch must keep recovery available to a transport retry.
        emptySessions.delete(request.sessionId);
        if (request.messageId) requests.releaseRecoveryPrompt(request.messageId);
        return response;
      };
      return client;
    },
  };
}
