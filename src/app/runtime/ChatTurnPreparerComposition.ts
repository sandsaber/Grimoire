import { ChatTurnRequestPreparerRegistry } from '../../core/providers/ChatTurnRequestPreparer';
import type { AcpMcpServerSource } from '../../providers/acp/app/AcpMcpServerSource';
import { ManagedAcpTurnRequestPreparer } from '../../providers/acp/app/ManagedAcpTurnRequestPreparer';
import { CLAUDE_EXECUTION_REQUEST_KIND } from '../../providers/claude/app/ClaudeApplicationContextFactory';
import { ClaudeTurnRequestPreparer } from '../../providers/claude/app/ClaudeTurnRequestPreparer';
import { CLAUDE_EXECUTION_DESCRIPTOR } from '../../providers/claude/execution/ClaudeExecutionBackend';
import { ClaudeCliResolver } from '../../providers/claude/runtime/ClaudeCliResolver';
import { GEMINI_EXECUTION_REQUEST_KIND } from '../../providers/gemini/app/GeminiApplicationContextFactory';
import { GEMINI_EXECUTION_DESCRIPTOR } from '../../providers/gemini/execution/GeminiExecutionBackend';
import { GeminiCliResolver } from '../../providers/gemini/runtime/GeminiCliResolver';
import { buildGeminiRuntimeEnv } from '../../providers/gemini/runtime/GeminiRuntimeEnvironment';
import { GROK_EXECUTION_REQUEST_KIND } from '../../providers/grok/app/GrokApplicationContextFactory';
import { GrokTurnRequestPreparer } from '../../providers/grok/app/GrokTurnRequestPreparer';
import { GROK_EXECUTION_DESCRIPTOR } from '../../providers/grok/execution/GrokExecutionBackend';
import { GrokCliResolver } from '../../providers/grok/runtime/GrokCliResolver';
import { buildGrokAgentProcessArgs } from '../../providers/grok/runtime/GrokLaunchArgs';
import { prepareGrokLaunchArtifacts } from '../../providers/grok/runtime/GrokLaunchArtifacts';
import { buildGrokRuntimeEnv } from '../../providers/grok/runtime/GrokRuntimeEnvironment';
import { KIMICODE_EXECUTION_REQUEST_KIND } from '../../providers/kimicode/app/KimicodeApplicationContextFactory';
import { KIMICODE_EXECUTION_DESCRIPTOR } from '../../providers/kimicode/execution/KimicodeExecutionBackend';
import { KimicodeCliResolver } from '../../providers/kimicode/runtime/KimicodeCliResolver';
import { prepareKimicodeLaunchArtifacts } from '../../providers/kimicode/runtime/KimicodeLaunchArtifacts';
import { buildKimicodeRuntimeEnv } from '../../providers/kimicode/runtime/KimicodeRuntimeEnvironment';
import { MIMOCODE_EXECUTION_REQUEST_KIND } from '../../providers/mimocode/app/MimocodeApplicationContextFactory';
import { MIMOCODE_EXECUTION_DESCRIPTOR } from '../../providers/mimocode/execution/MimocodeExecutionBackend';
import { MimocodeCliResolver } from '../../providers/mimocode/runtime/MimocodeCliResolver';
import { prepareMimocodeLaunchArtifacts } from '../../providers/mimocode/runtime/MimocodeLaunchArtifacts';
import { buildMimocodeRuntimeEnv } from '../../providers/mimocode/runtime/MimocodeRuntimeEnvironment';
import { OPENCODE_EXECUTION_REQUEST_KIND } from '../../providers/opencode/app/OpencodeApplicationContextFactory';
import { OPENCODE_EXECUTION_DESCRIPTOR } from '../../providers/opencode/execution/OpencodeExecutionBackend';
import { OpencodeCliResolver } from '../../providers/opencode/runtime/OpencodeCliResolver';
import { prepareOpencodeLaunchArtifacts } from '../../providers/opencode/runtime/OpencodeLaunchArtifacts';
import { buildOpencodeRuntimeEnv } from '../../providers/opencode/runtime/OpencodeRuntimeEnvironment';
import { QWEN_EXECUTION_REQUEST_KIND } from '../../providers/qwen/app/QwenApplicationContextFactory';
import { QWEN_EXECUTION_DESCRIPTOR } from '../../providers/qwen/execution/QwenExecutionBackend';
import { QwenCliResolver } from '../../providers/qwen/runtime/QwenCliResolver';
import { buildQwenRuntimeEnv } from '../../providers/qwen/runtime/QwenRuntimeEnvironment';
import type { ApplicationExecutionRequestBroker } from './ApplicationExecutionRequestBroker';

/**
 * Composes the provider-owned chat turn preparers.
 *
 * Only providers listed here can start a turn. A provider that is absent fails
 * closed with a named error rather than registering a launch reference nothing
 * can resolve — which is how the Phase 9 cutover left every provider.
 *
 * Adding a provider means implementing its preparer and registering it here;
 * see Phase 12B in `docs/provider-execution-migration-plan.md`.
 */
export function createChatTurnRequestPreparers(options: {
  readonly requests: ApplicationExecutionRequestBroker;
  /** Grimoire-owned MCP servers. Absent until a vault adapter is available. */
  readonly mcpServers?: AcpMcpServerSource;
  readonly userName?: string;
}): ChatTurnRequestPreparerRegistry {
  const userName = options.userName ? { userName: options.userName } : {};
  const mcp = options.mcpServers;
  const loadMcpServers = (providerId: 'opencode' | 'mimocode' | 'kimicode' | 'grok' | 'gemini' | 'qwen') => (
    mcp ? { loadMcpServers: () => mcp.load(providerId) } : {}
  );
  return new ChatTurnRequestPreparerRegistry([
    new ManagedAcpTurnRequestPreparer({
      providerId: 'opencode',
      ...loadMcpServers('opencode'),
      displayName: 'OpenCode',
      executableName: 'opencode',
      backendId: OPENCODE_EXECUTION_DESCRIPTOR.backendId,
      requestKind: OPENCODE_EXECUTION_REQUEST_KIND,
      configEnvVar: 'OPENCODE_CONFIG',
      launchArguments: ['acp'],
      requests: options.requests,
      cliResolver: new OpencodeCliResolver(),
      prepareLaunchArtifacts: prepareOpencodeLaunchArtifacts,
      buildRuntimeEnv: buildOpencodeRuntimeEnv,
      ...userName,
    }),
    new ManagedAcpTurnRequestPreparer({
      providerId: 'mimocode',
      ...loadMcpServers('mimocode'),
      displayName: 'MiMoCode',
      executableName: 'mimocode',
      backendId: MIMOCODE_EXECUTION_DESCRIPTOR.backendId,
      requestKind: MIMOCODE_EXECUTION_REQUEST_KIND,
      configEnvVar: 'MIMOCODE_CONFIG',
      launchArguments: ['acp'],
      requests: options.requests,
      cliResolver: new MimocodeCliResolver(),
      prepareLaunchArtifacts: prepareMimocodeLaunchArtifacts,
      buildRuntimeEnv: buildMimocodeRuntimeEnv,
      ...userName,
    }),
    new ManagedAcpTurnRequestPreparer({
      providerId: 'kimicode',
      ...loadMcpServers('kimicode'),
      displayName: 'Kimi Code',
      executableName: 'kimi',
      backendId: KIMICODE_EXECUTION_DESCRIPTOR.backendId,
      requestKind: KIMICODE_EXECUTION_REQUEST_KIND,
      configEnvVar: 'KIMICODE_CONFIG',
      launchArguments: ['acp'],
      requests: options.requests,
      cliResolver: new KimicodeCliResolver(),
      prepareLaunchArtifacts: prepareKimicodeLaunchArtifacts,
      buildRuntimeEnv: buildKimicodeRuntimeEnv,
      ...userName,
    }),
    // Gemini and Qwen generate no configuration file, so they have no launch
    // artifacts and their restart fingerprint is derived from the launch inputs.
    new ManagedAcpTurnRequestPreparer({
      providerId: 'gemini',
      ...loadMcpServers('gemini'),
      displayName: 'Gemini CLI',
      executableName: 'gemini',
      backendId: GEMINI_EXECUTION_DESCRIPTOR.backendId,
      requestKind: GEMINI_EXECUTION_REQUEST_KIND,
      launchArguments: ['--acp'],
      requests: options.requests,
      cliResolver: new GeminiCliResolver(),
      buildRuntimeEnv: buildGeminiRuntimeEnv,
      ...userName,
    }),
    new ManagedAcpTurnRequestPreparer({
      providerId: 'qwen',
      ...loadMcpServers('qwen'),
      displayName: 'Qwen Code',
      executableName: 'qwen',
      backendId: QWEN_EXECUTION_DESCRIPTOR.backendId,
      requestKind: QWEN_EXECUTION_REQUEST_KIND,
      launchArguments: ['--acp'],
      requests: options.requests,
      cliResolver: new QwenCliResolver(),
      buildRuntimeEnv: buildQwenRuntimeEnv,
      ...userName,
    }),
    // Grok is managed-ACP but does not share the family's preparation order:
    // its artifacts come before the environment, and its arguments depend on
    // the configured permission mode and reasoning effort.
    new GrokTurnRequestPreparer({
      backendId: GROK_EXECUTION_DESCRIPTOR.backendId,
      requestKind: GROK_EXECUTION_REQUEST_KIND,
      requests: options.requests,
      cliResolver: new GrokCliResolver(),
      prepareLaunchArtifacts: prepareGrokLaunchArtifacts,
      buildRuntimeEnv: buildGrokRuntimeEnv,
      buildProcessArguments: buildGrokAgentProcessArgs,
      ...loadMcpServers('grok'),
      ...userName,
    }),
    // Claude is not managed-ACP: its startup reference resolves to SDK options
    // rather than a process launch specification.
    new ClaudeTurnRequestPreparer({
      backendId: CLAUDE_EXECUTION_DESCRIPTOR.backendId,
      requestKind: CLAUDE_EXECUTION_REQUEST_KIND,
      requests: options.requests,
      cliResolver: new ClaudeCliResolver(),
    }),
  ]);
}
