# Chat Feature Agent Instructions

`src/features/chat/` assembles the sidebar chat workspace around provider-neutral runtime contracts. It owns tab lifecycle, chat state, rendering, input orchestration, and provider-neutral UI.

## Boundaries

- `GrimoireView` assembles tabs, controllers, renderers, and shared UI.
- `TabManager`, `Tab`, and `TabBar` own multi-tab lifecycle and tab-level provider coordination.
- Prefer extracting cohesive helpers from `tabs/Tab.ts` into focused modules rather than growing it further:
  - `tabSettings.ts` — draft/model snapshots, provider capabilities, command catalogs
  - `tabDOM.ts` — shell DOM construction and input resize handle
  - `tabScroll.ts` — per-tab auto-scroll helpers
- `ChatState` is per-tab. Do not move per-tab runtime or scroll state into globals.
- `InputController` builds provider-neutral `ChatTurnRequest` values. Providers own prompt encoding through `prepareTurn()`.
- `StreamController` consumes provider-neutral `StreamChunk` values and updates DOM state.
- Provider-owned services must be resolved through `ProviderRegistry` or `ProviderWorkspaceRegistry`.

## Rendering

- `MessageRenderer` owns message orchestration, markdown rendering, rewind/fork affordances, images, and copy buttons.
- `ToolCallRenderer`, `ThinkingBlockRenderer`, `WriteEditRenderer`, `DiffRenderer`, and `SubagentRenderer` own specialized render surfaces. Todo lists are parsed by `core/tools/todo` and presented through `rendering/todoUtils.ts`.
- Keep provider-specific tool normalization in provider code. Chat rendering should consume normalized `ToolCallInfo` and related shared types.
- Long tool outputs and tables must remain readable in the chat column. Prefer contained scrolling/truncation over widening the chat.

## Auto-Scroll

- Auto-scroll is per-tab.
- User scroll-up disables auto-follow for that tab.
- Jump-to-latest re-enables auto-follow.
- When returning to an inactive tab, scroll to latest only if that tab was still following the bottom before it was hidden.

## Gotchas

- `GrimoireView.onClose()` must abort active tabs and dispose runtimes.
- Blank tabs stay cold until first send.
- Title generation runs concurrently per conversation and routes by the global title-generation model selection.
- `/compact` is provider-owned: Claude relies on native command behavior; Codex routes through `thread/compact/start`.
- `/image [prompt]` is provider-neutral orchestration. Grimoire does not call image APIs directly; the active CLI/provider is responsible for generating a vault file and returning an Obsidian image embed.
- Bang-bash mode bypasses provider runtimes and is available only when an enabled provider exposes it in `ProviderChatUIConfig`.
- `projections/`, `application/` and `rendering/ChatProjectionRenderer.ts` are M5's replacement path and are **dark**: `ChatProjection` is what a conversation looks like derived from what the kernel recorded, `ChatExecutionCoordinator` owns turn acceptance, dispatch, the persistence barrier and queued-input release, and `ChatProjectionRenderer` turns successive projections into the calls a surface makes. Nothing constructs the coordinator and nothing implements `ChatRenderTarget` yet — `InputController` and `StreamController` still own all of it on the legacy path. All three are held to the plan's stop condition by `executionCompositionBoundaries.test.ts`: no DOM types, CSS class names, element structure or layout vocabulary, so a UI redesign stays a target swap.
