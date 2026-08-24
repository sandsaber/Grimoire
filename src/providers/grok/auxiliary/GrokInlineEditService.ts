import { LazyAuxQueryRunner } from '../../../core/auxiliary/LazyAuxQueryRunner';
import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type GrimoirePlugin from '../../../main';

/**
 * Inline edits, on the execution kernel.
 *
 * One runner for the service, deliberately: `continueConversation` sends a
 * second message expecting the first to still be there, and the auxiliary
 * conversation is retained for exactly as long as this runner is not reset.
 */
export class GrokInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: GrimoirePlugin) {
    super(new LazyAuxQueryRunner(
      () => plugin.getGrokExecution().createAuxRunner('inline'),
    ));
  }
}
