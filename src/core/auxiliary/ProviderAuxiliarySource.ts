import type { AuxQueryRunner } from './AuxQueryRunner';

/**
 * The three things a provider runs outside a conversation.
 *
 * Named once here because the five kernel-backed providers had already agreed
 * on the vocabulary — `'inline' | 'instructions' | 'title-gen'`, written five
 * times — and the retention key an auxiliary conversation is held under is
 * keyed by it. A provider maps this onto its own words; nothing above the
 * provider needs to know them.
 */
export type AuxiliaryPurpose = 'inline-edit' | 'instruction-refine' | 'title';

/**
 * What a provider contributes to auxiliary work: a runner, per purpose.
 *
 * **Not three backends**, which is what the module slot said until this
 * checkpoint. Every provider that runs auxiliary work runs it through the
 * backend it already has, on a conversation retained under a purpose key — so
 * three `ExecutionBackendFactory` slots described a shape nothing had, and
 * could not have been filled from a provider module anyway: the composition a
 * runner needs is built by the host, from a plugin, at load.
 *
 * A provider that contributes none of this is a provider that cannot do
 * auxiliary work, and the host says so in the one place the answer is visible —
 * rather than each provider shipping three services that politely fail.
 */
export interface ProviderAuxiliarySource {
  /**
   * One runner per service, not per query.
   *
   * `continueConversation` sends a second message expecting the first to still
   * be there, and the auxiliary conversation lives exactly as long as the
   * runner is not reset. Title generation resets after every title, which is
   * what closes the process the answer came from.
   */
  createRunner(purpose: AuxiliaryPurpose): AuxQueryRunner;
  /**
   * The model this provider would use for a title, if it owns the configured
   * one. Provider knowledge: ownership and any decoding of a composite id.
   */
  resolveTitleModel?(): string | undefined;
}
