# Providers Agent Instructions

`src/providers/` contains provider adapters and provider-owned workspace services. Shared provider contracts belong in `src/core/providers/`; concrete runtime behavior belongs in a provider subdirectory.

## Rules

- Declare runtimes, capabilities and auxiliary services on the provider's `ProviderModule`, which `BuiltInProviderCatalog` holds. Only workspace services still register, through `ProviderWorkspaceRegistry`.
- Keep provider-specific launch specs, CLI resolution, history parsing, storage, settings tabs, and UI config in the concrete provider directory.
- Keep cross-provider protocol helpers only when at least two providers use them. ACP helpers belong in `src/providers/acp/`.
- Do not leak provider-specific `providerState` fields into `src/features/`; expose typed provider helpers or neutral runtime/session updates instead.
- Provider defaults and enablement should stay explicit. Do not silently turn opt-in providers into default providers.
- Provider plan usage belongs to provider-owned stores registered through `ProviderWorkspaceRegistry`. UI code consumes only the shared `ProviderPlanUsageProvider` contract.

## When Adding or Changing a Provider

- Add or update the provider's `ProviderModule` — manifest, capabilities, settings codec, declarations, workspace and runtime ports — together with its chat UI config, plan-usage provider and workspace services. There is no `registration.ts`: the chat registry and the nine files that filled it are deleted.
- Add focused tests for provider routing, settings projection, launch/config changes, and any stream normalization behavior.
- Capture current wire/runtime output before normalizing new event shapes.
