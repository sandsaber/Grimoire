import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import { KimicodeAuxQueryRunner } from '../runtime/KimicodeAuxQueryRunner';

export class KimicodeInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: LegacyProviderContext) {
    super(new KimicodeAuxQueryRunner(plugin, {
      agentProfile: 'passive',
      artifactPurpose: 'instructions',
    }));
  }
}
