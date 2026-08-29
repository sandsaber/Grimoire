import type { ApprovalDecision } from '../../core/types';
import type {
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
} from './types';

type AcpPermissionOption = AcpRequestPermissionRequest['options'][number];
type AcpPermissionKind = AcpPermissionOption['kind'];

export function mapAcpApprovalDecision(
  decision: ApprovalDecision,
  options: readonly Pick<AcpPermissionOption, 'kind' | 'optionId'>[],
): AcpRequestPermissionResponse {
  if (typeof decision === 'object' && decision.type === 'select-option') {
    return {
      outcome: {
        optionId: decision.value,
        outcome: 'selected',
      },
    };
  }

  if (decision === 'allow') {
    return selectAcpPermissionOption(options, ['allow_once', 'allow_always']);
  }

  if (decision === 'allow-always') {
    return selectAcpPermissionOption(options, ['allow_always', 'allow_once']);
  }

  if (decision === 'deny') {
    return selectAcpPermissionOption(options, ['reject_once', 'reject_always']);
  }

  return { outcome: { outcome: 'cancelled' } };
}

function selectAcpPermissionOption(
  options: readonly Pick<AcpPermissionOption, 'kind' | 'optionId'>[],
  preferredKinds: readonly AcpPermissionKind[],
): AcpRequestPermissionResponse {
  for (const kind of preferredKinds) {
    const option = options.find((entry) => entry.kind === kind);
    if (option) {
      return {
        outcome: {
          optionId: option.optionId,
          outcome: 'selected',
        },
      };
    }
  }

  return { outcome: { outcome: 'cancelled' } };
}
