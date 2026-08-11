import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import { decodeGrokModelId } from '../models';
import { GrokAuxQueryRunner } from '../runtime/GrokAuxQueryRunner';
import { grokChatUIConfig } from '../ui/GrokChatUIConfig';

export class GrokTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: LegacyProviderContext) {
    super({
      createRunner: () => new GrokAuxQueryRunner(plugin, {
        agentProfile: 'passive',
        artifactPurpose: 'title-gen',
      }),
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
