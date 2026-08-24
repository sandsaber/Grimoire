import { LazyAuxQueryRunner } from '../../../core/auxiliary/LazyAuxQueryRunner';
import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type GrimoirePlugin from '../../../main';

/** Instruction refinement, on the execution kernel. */
export class CodexInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: GrimoirePlugin) {
    super(new LazyAuxQueryRunner(
      () => plugin.getCodexExecution().createAuxRunner('instructions'),
    ));
  }
}
