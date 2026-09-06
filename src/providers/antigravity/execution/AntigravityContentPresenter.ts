import type { StreamChunk } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import {
  normalizeAntigravityToolInput,
  normalizeAntigravityToolName,
} from '../normalization/antigravityToolNormalization';
import type { AntigravityStreamEvent } from '../runtime/AntigravityStreamJson';

/**
 * What a `agy` step becomes on the surface.
 *
 * The provider's whole content vocabulary is two shapes — a tool call starting
 * and the same call ending — because everything else it says is the answer, and
 * the answer travels on the transient output channel as it arrives. There is no
 * session, no plan and no interaction to present: print mode has none of them.
 *
 * Tool *names* and argument keys are translated here rather than in the shared
 * renderer, which is what earns an `agy` call the same card as any other
 * provider's — icon, header and diff rendering all key off the neutral names —
 * and keeps `agy`'s vocabulary inside this provider.
 */
export class AntigravityContentPresenter {
  present(payload: unknown): readonly StreamChunk[] {
    const event = payload as AntigravityStreamEvent | undefined;
    if (!event || typeof event !== 'object' || !('type' in event)) {
      return [];
    }
    // Grimoire's own event, not `agy`'s: this provider takes images as temp
    // files whose paths go into the prompt, and an image that never became a
    // file has to say so where the user is looking.
    if ((event as { type: string }).type === 'attachments_dropped') {
      const names = (event as unknown as { names?: readonly string[] }).names ?? [];
      return names.length
        ? [{ type: 'notice', content: t('chat.ui.images.notAttached', { names: names.join(', ') }) }]
        : [];
    }
    if (event.type === 'tool_start') {
      const name = normalizeAntigravityToolName(event.toolName);
      return [{
        type: 'tool_use',
        id: event.stepId,
        name,
        input: normalizeAntigravityToolInput(event.toolName, event.input),
      }];
    }
    if (event.type === 'tool_end') {
      // The id is the step's, so the card that opened is the card that closes.
      // `agy` brackets a call with an ACTIVE/DONE pair sharing one step index,
      // which is the only thing tying the two halves together.
      return [{ type: 'tool_result', id: event.stepId, content: event.output }];
    }
    return [];
  }
}
