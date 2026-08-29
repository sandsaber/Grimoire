import { mapAcpApprovalDecision } from '@/providers/acp/acpApprovals';

describe('acpApprovals', () => {
  const options = [
    { kind: 'allow_once' as const, name: 'Allow once', optionId: 'allow-1' },
    { kind: 'allow_always' as const, name: 'Allow always', optionId: 'allow-all' },
    { kind: 'reject_once' as const, name: 'Reject', optionId: 'reject-1' },
  ];

  it('maps allow / allow-always / deny to ACP permission options', () => {
    expect(mapAcpApprovalDecision('allow', options)).toEqual({
      outcome: { optionId: 'allow-1', outcome: 'selected' },
    });
    expect(mapAcpApprovalDecision('allow-always', options)).toEqual({
      outcome: { optionId: 'allow-all', outcome: 'selected' },
    });
    expect(mapAcpApprovalDecision('deny', options)).toEqual({
      outcome: { optionId: 'reject-1', outcome: 'selected' },
    });
    expect(mapAcpApprovalDecision('cancel', options)).toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });

  it('maps select-option decisions by value', () => {
    expect(mapAcpApprovalDecision({ type: 'select-option', value: 'allow-all' }, options)).toEqual({
      outcome: { optionId: 'allow-all', outcome: 'selected' },
    });
  });

});
