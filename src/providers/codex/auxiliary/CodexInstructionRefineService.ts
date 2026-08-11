import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import { CodexAuxQueryRunner } from '../runtime/CodexAuxQueryRunner';

export class CodexInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: LegacyProviderContext) {
    super(new CodexAuxQueryRunner(plugin));
  }
}
