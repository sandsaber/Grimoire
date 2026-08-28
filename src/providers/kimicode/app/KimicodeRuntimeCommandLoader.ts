import type GrimoirePlugin from '../../../main';
import { AcpRuntimeCommandLoader } from '../../acp/commands/AcpRuntimeCommandLoader';
import { getKimicodeProviderSettings } from '../settings';

/**
 * Kimicode's slash-command listing, which is the shared ACP one.
 *
 * Four providers had four byte-similar copies of the rule about when it is safe
 * to open a session to ask. What is kimicode's own is named here: its settings
 * flag, its metadata session, and the id it mints — see the shared file for why
 * that last one still differs between the four.
 */
export function createKimicodeRuntimeCommandLoader(
  plugin: GrimoirePlugin,
): AcpRuntimeCommandLoader {
  return new AcpRuntimeCommandLoader({
    providerId: 'kimicode',
    isEnabled: settings => getKimicodeProviderSettings(settings).enabled,
    listAnnounced: () => plugin.getKimicodeExecution().metadata.listCommands(),
    commandId: name => `kimicode:${name}`,
  });
}
