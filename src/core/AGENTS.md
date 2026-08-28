# Core Agent Instructions

`src/core/` is provider-neutral infrastructure. Features and providers depend on these contracts; core must not depend on feature UI or provider implementation details.

## Boundaries

- `runtime/` defines neutral chat runtime contracts — prepared turns, query options, approvals, session updates — and `runtime/execution/` the presentation adapter over the kernel. The `ChatRuntime` interface itself is deleted.
- `providers/` defines registries, capabilities, model routing, environment, settings projection, and workspace-service contracts.
- `bootstrap/` owns provider-neutral session metadata storage and shared app-storage contracts.
- `debug/` owns sanitized file logging. Debug logs must be opt-in and must not include prompts, answers, note content, paths, environment values, or secrets.
- `mcp/` owns provider-neutral MCP config parsing, testing, and coordination.
- `prompt/` owns shared Grimoire prompt text and provider-neutral prompt helpers.
- `storage/` provides generic vault/home filesystem adapters only.
- `tools/` owns shared tool constants, tool formatting helpers, todo types, and tool name classification.
- `types/` owns cross-feature type definitions.

## Rules

- Add shared contracts here only when at least two providers or features need them.
- Keep provider-owned storage, transcript hydration, CLI resolution, and protocol parsing under `src/providers/<provider>/`.
- Keep feature-specific UI state under `src/features/`.
- Treat `Conversation.providerState` as opaque outside provider-owned helpers.
- Title generation is routed by the global title-generation model setting, not by the active chat tab provider.

## Gotchas

- `ProviderWorkspaceRegistry` owns workspace services such as command catalogs, agent mentions, MCP managers, CLI resolvers, usage providers, and settings tabs.
- A tab's `ExecutionChatRuntimeAdapter` must be cleaned up when the tab is disposed.
- Plan mode is capability-driven. Claude and Codex surface it through different provider-native mechanisms, so shared code should not hard-code provider event names.
