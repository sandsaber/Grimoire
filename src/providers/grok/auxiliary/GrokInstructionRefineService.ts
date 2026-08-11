import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import { GrokAuxQueryRunner } from '../runtime/GrokAuxQueryRunner';

export class GrokInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: LegacyProviderContext) {
    super(new GrokAuxQueryRunner(plugin, {
      agentProfile: 'passive',
      artifactPurpose: 'instructions',
    }));
  }
}
