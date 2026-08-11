import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import { decodeKimicodeModelId } from '../models';
import { KimicodeAuxQueryRunner } from '../runtime/KimicodeAuxQueryRunner';
import { kimicodeChatUIConfig } from '../ui/KimicodeChatUIConfig';

export class KimicodeTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: LegacyProviderContext) {
    super({
      createRunner: () => new KimicodeAuxQueryRunner(plugin, {
        agentProfile: 'passive',
        artifactPurpose: 'title-gen',
      }),
      resolveModel: () => {
        const settings = plugin.settings as unknown as Record<string, unknown>;
        const titleModel = typeof settings.titleGenerationModel === 'string'
          ? settings.titleGenerationModel
          : '';
        if (!kimicodeChatUIConfig.ownsModel(titleModel, settings)) {
          return undefined;
        }

        return decodeKimicodeModelId(titleModel) ?? undefined;
      },
    });
  }
}
