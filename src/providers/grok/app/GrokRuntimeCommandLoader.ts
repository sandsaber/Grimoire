import { AcpRuntimeCommandLoader } from '../../acp/commands/AcpRuntimeCommandLoader';
import { getGrokProviderSettings } from '../settings';

/**
 * Grok's slash-command listing, which is the shared ACP one.
 *
 * Four providers had four byte-similar copies of the rule about when it is safe
 * to open a session to ask. What is grok's own is named here: its settings
 * flag, its metadata session, and the id it mints — see the shared file for why
 * that last one still differs between the four.
 */
export const grokRuntimeCommandLoader = new AcpRuntimeCommandLoader({
  providerId: 'grok',
  isEnabled: settings => getGrokProviderSettings(settings).enabled,
  listAnnounced: context => context.plugin.getGrokExecution().metadata.listCommands(),
  commandId: name => `acp:${name}`,
  source: 'sdk',
});
