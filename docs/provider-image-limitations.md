# Images through custom Responses endpoints

## Command Code endpoint with Codex (#208)

The report in [Grimoire #208](https://github.com/sandsaber/Grimoire/issues/208)
and [Command Code #902](https://github.com/CommandCodeAI/command-code/issues/902)
reproduces an endpoint defect with raw HTTP, without Codex or Grimoire. The upstream
issue remained open when checked on 2026-09-21; the measurements below are the
reporter's results, not a new endpoint test by Grimoire.

Affected configuration: Codex CLI 0.155.1, `wire_api = "responses"`,
`base_url = "https://api.commandcode.ai/provider/v1"`, and
`deepseek/deepseek-v4.1-flash`. Other endpoints and models were not established as
affected by this report.

User-message `input_image` parts reach the model as images. The same parts inside
`function_call_output.output` reach it as base64 text: the model cannot see the
picture, and the text consumes roughly 0.92 tokens per image byte in the reported
tests. Repeated image reads can exceed the context limit within one turn. Native
compaction can then fail too, because it sends the oversized history.

Grimoire sends user input to Codex's app-server. Codex owns built-in tool execution
and HTTP requests to its configured model endpoint. Grimoire has no Responses
adapter in that path and cannot remap or trim those tool-result images before
submission. Changing the separate Command Code CLI provider would not fix it.
The upstream endpoint must preserve image content in tool results or explicitly
reject unsupported images instead of serializing them as text.

## Avoiding the reported failure

- Attach the image directly to a user message. That path worked in the reported
  setup. Ask the agent to use the attached image and avoid `view_image` or other
  tools that return image content on this endpoint. Instructions are not a hard
  tool restriction.
- If the agent creates crops or new images, attach those files in a subsequent
  user message instead of asking it to inspect them through image tool results.
- Reducing file size only reduces the text cost; it does **not** make a tool-result
  image visible to the model. Changing `detail` did not reduce the payload in the
  reported Codex version. Do not rely on either as a fix.
- `tools.view_image=false` was rejected as an unknown configuration field by
  Codex 0.155.1 in the report. Grimoire does not install this unsupported setting.

If the conversation is already over the limit, stop retrying the same turn.
Create a new chat with a short summary of the visible transcript and reattach the
needed images directly. Check files the agent already wrote before rerunning
work: a failed response does not roll back file changes. Grimoire does not rewrite
native Codex history or promise that compaction can recover an oversized thread.

Reasonix's opt-in **Image attachments as files** (#206) and the Command Code CLI's
setting of the same name deliver paths for tools to read. They do not repair this
Responses endpoint. Whether a tool can show an image still depends on its runtime,
model, and endpoint.
