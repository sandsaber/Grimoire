import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import type { AuxiliaryPurpose } from '../../../core/auxiliary/ProviderAuxiliarySource';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { READ_ONLY_TOOLS } from '../../../core/tools/toolNames';
import type GrimoirePlugin from '../../../main';
import { runColdStartQuery } from '../runtime/claudeColdStartQuery';
import { createReadOnlyHook } from './claudeReadOnlyHook';

/**
 * Claude's auxiliary work, behind the one runner interface all nine share.
 *
 * The three services this replaces were the same twenty lines around
 * `runColdStartQuery` three times, each holding the session id its own
 * `continueConversation` resumes — which is exactly what `reset()` means. The
 * differences that are real are the ones kept below, and they are per purpose,
 * not per service.
 *
 * Still a cold query rather than a kernel run: Claude's auxiliary reference
 * space is not wired yet, and its composition refuses auxiliary work rather
 * than answering it emptily. Moving it is a step behind this seam, not through
 * it — which is the point of the seam being uniform first.
 */
export class ClaudeAuxQueryRunner implements AuxQueryRunner {
  private sessionId: string | null = null;

  constructor(
    private readonly plugin: GrimoirePlugin,
    private readonly purpose: AuxiliaryPurpose,
  ) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const result = await runColdStartQuery({
      plugin: this.plugin,
      systemPrompt: config.systemPrompt,
      ...this.purposeOptions(),
      ...(config.model ? { model: config.model } : {}),
      ...(this.sessionId ? { resumeSessionId: this.sessionId } : {}),
      ...(config.abortController ? { abortController: config.abortController } : {}),
      ...(config.onTextChunk ? { onTextChunk: config.onTextChunk } : {}),
    }, prompt);
    this.sessionId = result.sessionId;
    return result.text;
  }

  reset(): void {
    this.sessionId = null;
  }

  /**
   * A title is one question with no follow-up, so it persists no session and
   * skips thinking; an inline edit may read the vault to answer, so it gets the
   * read-only tools and the hook that refuses everything else.
   */
  private purposeOptions(): {
    hooks?: ReturnType<typeof buildReadOnlyHooks>;
    persistSession?: boolean;
    providerSettings?: Record<string, unknown>;
    thinking?: { disabled: true };
    tools: string[];
  } {
    if (this.purpose === 'title') {
      return { persistSession: false, thinking: { disabled: true }, tools: [] };
    }
    if (this.purpose === 'inline-edit') {
      return {
        hooks: buildReadOnlyHooks(),
        providerSettings: ProviderSettingsCoordinator.getProviderSettingsSnapshot(
          this.plugin.settings,
          'claude',
        ),
        tools: [...READ_ONLY_TOOLS],
      };
    }
    return { tools: [] };
  }
}

function buildReadOnlyHooks() {
  return { PreToolUse: [createReadOnlyHook()] };
}
