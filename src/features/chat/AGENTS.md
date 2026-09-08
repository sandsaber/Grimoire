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
- Provider-owned services must be resolved through `ProviderCatalog` declarations or `ApplicationRuntime.workspaceFor()`. Never by importing a provider directly, and never through a global — there is no provider registry.

## Rendering

- `MessageRenderer` owns message orchestration, markdown rendering, rewind/fork affordances, images, and copy buttons.
- `ToolCallRenderer`, `ThinkingBlockRenderer`, `WriteEditRenderer`, `DiffRenderer`, and `SubagentRenderer` own specialized render surfaces. Todo lists are parsed by `core/tools/todo` and presented through `rendering/todoUtils.ts`.
- Keep provider-specific tool normalization in provider code. Chat rendering should consume normalized `ToolCallInfo` and related shared types.
- A control here is a `<button>`, or it goes through `asActivatable` from `shared/components/activatable.ts`. A `<span>` with a click listener is reachable by mouse and by nothing else; nineteen of them were. Icon plus label where a choice has a cost, icon only in dense repeating chrome and never without an accessible name, and never icon-only for something that cannot be taken back. An icon beside its own label takes `markDecorative`, or it announces as its Lucide file name. See the Design System section in the root `AGENTS.md`.
- Long tool outputs and tables must remain readable in the chat column. Prefer contained scrolling/truncation over widening the chat.
- The session-restart notice marks the end of the thread when a provider could not resume its saved session, so the history above is not mistaken for the agent's memory. Ask the runtime through the neutral `isSessionDropped()`; never read `providerState` from feature code. It is drawn before the user types - after a turn has been spent the warning has already cost what it was meant to save - and comes down as soon as a message joins the thread.

## Context

`ui/context-manager/` is what is attached to the next message, as one list. Before it the open note,
the mentioned vault paths and the external paths were drawn by three views that could not see each
other, so "what is attached, and what does it cost" had no answer past four chips.

- `ContextStore` is the single list. It owns order — insertion order inside a group, nothing
  re-sorted under the reader — and identity, so adding the same path twice flashes the row that is
  already there. Every surface reads it; none of them keeps its own copy.
- `ContextAttachments` binds the store to its three sources and mounts the three surfaces.
  `sync()` rebuilds the list from those sources, so anything a surface removes is detached at
  source rather than dropped from a copy. A thing with no source has nowhere to live: that is why
  an attached *folder* is expanded to its files at attach time, and why "current selection" and
  "clipboard" are not offered here — the selection is already carried by `SelectionController` on
  every turn, and pasting already works.
- `ContextComposerView` draws the composer's end. `CHIP_THRESHOLD` is 1: one chip always fits, and
  past it a summary line that never wraps. It is the same height as a chip row, deliberately —
  what is attached must not change how much room there is to write about it.
- `ContextManagerModal` and `ContextAddPicker` are the dialog and the quick picker. The picker is
  mounted **inside** the dialog when opened from it; a modal is its own stacking context.

The dialog is reachable from every state: the `☰` control pinned in the chip row's corner, `Manage`
in the summary row, `Review` on the over-budget row, and the `manage-context` command in
`src/main.ts`, which is the only one of the four a keyboard shortcut can reach. Do not add a state
that can attach something without also being able to open the dialog — the reason the control and
the command exist is that with two files attached there was no way in at all.

Costs are estimates by construction (`stat.size / 4`) and every surface labels them "est.". An
unknown cost is an em dash, never zero.

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
- `projections/`, `application/` and `rendering/ChatProjection*` are the chat path, and **every chat runs on it**. The composition is constructed at plugin load and each tab builds its end of it; `InputController.sendMessage` has one path, and a tab without a projection refuses to send rather than falling back, because there is nothing to fall back to.
- `ChatProjection` is what a conversation looks like derived from what the kernel recorded; `ChatExecutionCoordinator` owns turn acceptance, dispatch, the persistence barrier and queued-input release; `ChatProjectionRenderer` turns successive projections into the calls a surface makes; `ChatProjectionAttachment` binds one tab to one conversation's projection. Those four are held to the plan's stop condition by `executionCompositionBoundaries.test.ts`: no DOM types, CSS class names, element structure or layout vocabulary, so a UI redesign stays a target swap.
- `rendering/ChatSurfaceRenderTarget.ts` is the one piece of that path allowed to touch a DOM. It implements `ChatRenderTarget` over `StreamController`, `MessageRenderer` and `ChatState`, and every operation it performs goes through a queue — the column's work is asynchronous, and the renderer's order is only kept if the target keeps it. `settled()` is how a caller waits for the column before doing anything else to it.
