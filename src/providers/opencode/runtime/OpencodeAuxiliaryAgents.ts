import type { OpencodeManagedAgentConfig } from './OpencodeLaunchArtifacts';

/**
 * The Grimoire-managed agents an auxiliary OpenCode turn runs as.
 *
 * Auxiliary work — a title, a refinement, an inline edit — must not run with
 * the vault's own tool permissions: it is unattended, and there is no surface
 * for it to ask on. OpenCode has no per-request permission mode, so what it can
 * do is decided by the agent definition the launch artifacts write, which is
 * why this lives beside the artifacts rather than beside a runner.
 *
 * Two profiles, and the difference is reading files: an inline edit is given
 * the note it is editing and needs to read what is around it, while a title has
 * the message and needs nothing else at all.
 *
 * Shared by the legacy runner and the kernel path while both exist, so the
 * agent a turn runs as cannot depend on which one asked.
 */
export type OpencodeAuxAgentProfile = 'passive' | 'readonly';

export const OPENCODE_AUX_AGENT_IDS: Readonly<Record<OpencodeAuxAgentProfile, string>> = {
  passive: 'grimoire-aux-passive',
  readonly: 'grimoire-aux-readonly',
};

/** Read anything but a dotenv, which is the shape a credential is usually in. */
const OPENCODE_AUX_READ_PERMISSION = Object.freeze({
  '*': 'allow',
  '*.env': 'deny',
  '*.env.*': 'deny',
  '*.env.example': 'allow',
});

export function buildOpencodeAuxAgentConfig(
  profile: OpencodeAuxAgentProfile,
): OpencodeManagedAgentConfig {
  const id = OPENCODE_AUX_AGENT_IDS[profile];
  if (profile === 'readonly') {
    return {
      definition: {
        description: 'Internal Grimoire read-only agent for OpenCode auxiliary tasks.',
        mode: 'primary',
        permission: {
          '*': 'deny',
          codesearch: 'allow',
          external_directory: 'deny',
          glob: 'allow',
          grep: 'allow',
          lsp: 'allow',
          read: OPENCODE_AUX_READ_PERMISSION,
          webfetch: 'allow',
          websearch: 'allow',
        },
      },
      id,
    };
  }

  return {
    definition: {
      description: 'Internal Grimoire no-tool agent for OpenCode auxiliary tasks.',
      mode: 'primary',
      permission: {
        '*': 'deny',
        external_directory: 'deny',
      },
    },
    id,
  };
}
