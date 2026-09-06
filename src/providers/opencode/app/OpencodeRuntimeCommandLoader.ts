import type GrimoirePlugin from '../../../main';
import { AcpRuntimeCommandLoader } from '../../acp/commands/AcpRuntimeCommandLoader';
import { getOpencodeProviderSettings } from '../settings';

/**
 * Opencode's slash-command listing, which is the shared ACP one.
 *
 * Four providers had four byte-similar copies of the rule about when it is safe
 * to open a session to ask. What is opencode's own is named here: its settings
 * flag, its metadata session, and the id it mints — see the shared file for why
 * that last one still differs between the four.
 */
export function createOpencodeRuntimeCommandLoader(
  plugin: GrimoirePlugin,
): AcpRuntimeCommandLoader {
  return new AcpRuntimeCommandLoader({
    providerId: 'opencode',
    isEnabled: settings => getOpencodeProviderSettings(settings).enabled,
    listAnnounced: () => plugin.getOpencodeExecution().metadata.listCommands(),
    commandId: name => `opencode:${name}`,
  });
}
