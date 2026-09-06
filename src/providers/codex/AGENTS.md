# Codex Provider Agent Instructions

`src/providers/codex/` adapts OpenAI Codex through `codex app-server` over stdio JSON-RPC 2.0.

## Protocol Rules

- The startup handshake must send `initialize`, then notify `initialized`.
- Extended capabilities require `{ experimentalApi: true }` during initialize.
- Use `experimentalRawEvents: true` for live turns so provider-native raw response items can be projected into Grimoire stream chunks.
- JSONL is the replay source for history hydration and session-file discovery. Do not reintroduce live JSONL polling unless the app-server stops emitting equivalent raw notifications and the tradeoff is documented with a current wire trace.

## Runtime Gotchas

- `thread/resume` is required before operations on an existing thread in a new daemon process.
- For forks, resume the new fork thread before rollback. Do not resume the source thread for fork rollback.
- Notifications can arrive before the `turn/start` response establishes `currentTurnId`; buffer them until the turn ID is known.
- Compact turns can establish turn ID from `turn/started` notification instead of the RPC response.
- `serverRequest/resolved` can auto-dismiss approval or ask-user UI without client input.
- Plan indicators come from account rate-limit notifications and `account/rateLimits/read` through `CodexPlanUsageStore`. Failed refreshes must keep the last good value instead of blanking the UI.

## Provider-Owned Services

- `CodexSkillListingService` uses a short-lived app-server process for `skills/list`; keep it independent from chat runtime lifecycle.
- `CodexAuxiliaryQuery` runs auxiliary work — titles, refinement, inline edits — on its own
  app-server process and its own thread, one per retained conversation. What makes a turn
  auxiliary is on `thread/start`: `approvalPolicy: 'never'`, `sandbox: 'read-only'` whatever the
  chat is set to, and `persistExtendedHistory: false`. What this provider contributes is
  `CodexExecution.auxiliarySource()` — a runner per purpose — and the three services themselves are
  the application's, shared with every other provider.
- `CodexTaskResultInterpreter` is intentionally no-op because Grimoire's async Claude task system does not apply to Codex.
- Image inputs are written to a temp directory, sent as local image paths, and cleaned up in `query()` finally blocks.

## Storage and Environment

- Codex is the product's default provider and ships enabled; `settings.ts` defaults `enabled` to true, and a test pins it.
- Environment hash invalidation watches `OPENAI_MODEL`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY`; changes invalidate existing Codex session IDs.
- Session file paths may include a date prefix. `findCodexSessionFile` handles both direct and DFS fallback patterns.
