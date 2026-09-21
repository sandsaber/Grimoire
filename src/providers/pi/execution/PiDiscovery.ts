import { extractAcpSessionModelState, extractAcpSessionThoughtLevelState } from '@/providers/acp/AcpSessionConfig';
import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpNewSessionResponse } from '@/providers/acp/types';

import { getPiSettings, type PiSettings, updatePiSettings } from '../settings';

export function syncPiDiscovery(settings: Record<string, unknown>, session: Partial<AcpNewSessionResponse>): boolean {
  const models = extractAcpSessionModelState(session);
  const thinking = extractAcpSessionThoughtLevelState(session);
  const current = getPiSettings(settings);
  const discoveredModels = models.availableModels.map(model => ({ rawId: model.id, label: model.name || model.id,
    thinkingLevels: current.discoveredModels.find(item => item.rawId === model.id)?.thinkingLevels ?? [],
    ...(model.description ? { description: model.description } : {}) }));
  const thinkingLevels = thinking.availableLevels.map(level => level.id);
  const patch = {
    ...(session.configOptions?.some(option => option.category === 'model') || session.models
      ? { discoveredModels } : {}),
    ...(session.configOptions?.some(option => option.category === 'thought_level') ? { thinkingLevels } : {}),
  };
  if (Object.entries(patch).every(([key, value]) => JSON.stringify(current[key as keyof typeof current]) === JSON.stringify(value))) return false;
  updatePiSettings(settings, patch);
  return true;
}

// pi-acp advertises every effort for every model. Probe only this disposable
// metadata session: Pi clamps unsupported values, and no prompt is dispatched.
export async function discoverPiThinkingLevels(client: Pick<ManagedAcpClient, 'setConfigOption'>,
  session: AcpNewSessionResponse, signal: AbortSignal): Promise<PiSettings['discoveredModels']> {
  const models = extractAcpSessionModelState(session).availableModels;
  const levels = extractAcpSessionThoughtLevelState(session).availableLevels;
  const discovered: PiSettings['discoveredModels'] = [];
  for (const model of models) {
    signal.throwIfAborted();
    const selected = await client.setConfigOption({ sessionId: session.sessionId,
      configId: 'model', type: 'select', value: model.id });
    if (extractAcpSessionModelState(selected).currentModelId !== model.id) continue;
    const thinkingLevels: string[] = [];
    for (const level of levels) {
      signal.throwIfAborted();
      const response = await client.setConfigOption({ sessionId: session.sessionId,
        configId: 'thought_level', type: 'select', value: level.id });
      if (extractAcpSessionThoughtLevelState(response).currentLevel === level.id) thinkingLevels.push(level.id);
    }
    discovered.push({ rawId: model.id, label: model.name || model.id, description: model.description ?? undefined, thinkingLevels });
  }
  signal.throwIfAborted();
  return discovered;
}
