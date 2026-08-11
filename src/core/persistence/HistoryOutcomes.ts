export type HistoryHydrationOutcome<TMessage> =
  | { readonly kind: 'absent' }
  | { readonly kind: 'complete'; readonly messages: readonly TMessage[] }
  | {
    readonly kind: 'partial';
    readonly messages: readonly TMessage[];
    readonly warnings: readonly string[];
  }
  | {
    readonly kind: 'stale';
    readonly messages: readonly TMessage[];
    readonly nativeRevision?: string;
  }
  | { readonly kind: 'corrupt'; readonly errorClass: string }
  | {
    readonly kind: 'recovered';
    readonly messages: readonly TMessage[];
    readonly recoverySource: 'native-history' | 'grimoire-projection';
  };

export type ProviderNativeMutationOutcome =
  | { readonly kind: 'applied'; readonly nativeRevision?: string }
  | { readonly kind: 'rejected'; readonly reason: string; readonly sideEffectFree: true }
  | { readonly kind: 'unsupported' }
  | {
    readonly kind: 'indeterminate';
    readonly correlationId?: string;
    readonly reason: string;
  };
