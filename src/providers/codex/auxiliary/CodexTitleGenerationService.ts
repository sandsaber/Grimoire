import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type GrimoirePlugin from '../../../main';
import { codexChatUIConfig } from '../ui/CodexChatUIConfig';

/**
 * Titles, on the execution kernel.
 *
 * A runner per title, which is what this service has always built and what the
 * retained auxiliary conversation is keyed by: the daemon that generated one
 * title is closed when the service resets it, and the next title launches its
 * own. The composition owns the launch, the policy the thread runs under, and
 * the process.
 */
export class CodexTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: GrimoirePlugin) {
    super({
      createRunner: () => plugin.getCodexExecution().createAuxRunner('title-gen'),
      resolveModel: () => {
        const settings = plugin.settings as unknown as Record<string, unknown>;
        const titleModel = typeof settings.titleGenerationModel === 'string'
          ? settings.titleGenerationModel
          : '';
        return codexChatUIConfig.ownsModel(titleModel, settings)
          ? titleModel
          : undefined;
      },
    });
  }
}
