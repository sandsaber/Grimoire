import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import { MimocodeAuxQueryRunner } from '../runtime/MimocodeAuxQueryRunner';

export class MimocodeInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: LegacyProviderContext) {
    super(new MimocodeAuxQueryRunner(plugin, {
      agentProfile: 'passive',
      artifactPurpose: 'instructions',
    }));
  }
}
