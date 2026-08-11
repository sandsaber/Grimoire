import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import { KimicodeAuxQueryRunner } from '../runtime/KimicodeAuxQueryRunner';

export class KimicodeInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: LegacyProviderContext) {
    super(new KimicodeAuxQueryRunner(plugin, {
      agentProfile: 'readonly',
      artifactPurpose: 'inline',
      allowReadTextFile: true,
    }));
  }
}
