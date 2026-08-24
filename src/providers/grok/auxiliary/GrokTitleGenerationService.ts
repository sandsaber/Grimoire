import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type GrimoirePlugin from '../../../main';
import { decodeGrokModelId } from '../models';
import { grokChatUIConfig } from '../ui/GrokChatUIConfig';

/**
 * Titles, on the execution kernel.
 *
 * A runner per title, which is what this service has always built and what the
 * retained auxiliary conversation is keyed by: the process that generated one
 * title is closed when the service resets it, and the next title launches its
 * own. The composition owns the launch, the permission mode it runs under, and
 * the process.
 */
export class GrokTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: GrimoirePlugin) {
    super({
      createRunner: () => plugin.getGrokExecution().createAuxRunner('title-gen'),
      resolveModel: () => {
        const settings = plugin.settings as unknown as Record<string, unknown>;
        const titleModel = typeof settings.titleGenerationModel === 'string'
          ? settings.titleGenerationModel
          : '';
        if (!grokChatUIConfig.ownsModel(titleModel, settings)) {
          return undefined;
        }

        return decodeGrokModelId(titleModel) ?? undefined;
      },
    });
  }
}
