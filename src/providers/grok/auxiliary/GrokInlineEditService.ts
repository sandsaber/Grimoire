import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import { GrokAuxQueryRunner } from '../runtime/GrokAuxQueryRunner';

export class GrokInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: LegacyProviderContext) {
    super(new GrokAuxQueryRunner(plugin, {
      agentProfile: 'readonly',
      artifactPurpose: 'inline',
      allowReadTextFile: true,
    }));
  }
}
