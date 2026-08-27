import type { AuxiliaryPurpose } from '@/core/auxiliary/ProviderAuxiliarySource';

/**
 * The neutral purpose, in the word the five kernel providers use for it.
 *
 * Codex, Grok, OpenCode, MiMoCode and Kimi Code each declare the same three
 * literals — the retention key an auxiliary conversation is held under is built
 * from them — so the translation is one function rather than five identical
 * `switch` statements in five compositions.
 */
export function auxiliaryPurposeKey(
  purpose: AuxiliaryPurpose,
): 'inline' | 'instructions' | 'title-gen' {
  switch (purpose) {
    case 'inline-edit':
      return 'inline';
    case 'instruction-refine':
      return 'instructions';
    case 'title':
      return 'title-gen';
  }
}
