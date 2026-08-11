import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import { MimocodeAuxQueryRunner } from '../runtime/MimocodeAuxQueryRunner';

export class MimocodeInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: LegacyProviderContext) {
    super(new MimocodeAuxQueryRunner(plugin, {
      agentProfile: 'readonly',
      artifactPurpose: 'inline',
      allowReadTextFile: true,
    }));
  }
}
