import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type GrimoirePlugin from '../../../main';
import { decodeMimocodeModelId } from '../models';
import { mimocodeChatUIConfig } from '../ui/MimocodeChatUIConfig';

/**
 * Titles, on the execution kernel.
 *
 * A runner per title, which is what this service has always built and what the
 * retained auxiliary conversation is keyed by: the process that generated one
 * title is closed when the service resets it, and the next title launches its
 * own. The composition owns the launch, the agent it runs as, and the process.
 */
export class MimocodeTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: GrimoirePlugin) {
    super({
      createRunner: () => plugin.getMimocodeExecution().createAuxRunner('title-gen'),
      resolveModel: () => {
        const settings = plugin.settings as unknown as Record<string, unknown>;
        const titleModel = typeof settings.titleGenerationModel === 'string'
          ? settings.titleGenerationModel
          : '';
        if (!mimocodeChatUIConfig.ownsModel(titleModel, settings)) {
          return undefined;
        }

        return decodeMimocodeModelId(titleModel) ?? undefined;
      },
    });
  }
}
