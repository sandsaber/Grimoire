import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import { OpencodeAuxQueryRunner } from '../runtime/OpencodeAuxQueryRunner';

export class OpencodeInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: LegacyProviderContext) {
    super(new OpencodeAuxQueryRunner(plugin, {
      agentProfile: 'readonly',
      artifactPurpose: 'inline',
      allowReadTextFile: true,
    }));
  }
}
