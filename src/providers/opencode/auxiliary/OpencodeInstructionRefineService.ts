import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import { OpencodeAuxQueryRunner } from '../runtime/OpencodeAuxQueryRunner';

export class OpencodeInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: LegacyProviderContext) {
    super(new OpencodeAuxQueryRunner(plugin, {
      agentProfile: 'passive',
      artifactPurpose: 'instructions',
    }));
  }
}
