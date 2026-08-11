import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import { CodexAuxQueryRunner } from '../runtime/CodexAuxQueryRunner';

export class CodexInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: LegacyProviderContext) {
    super(new CodexAuxQueryRunner(plugin));
  }
}
