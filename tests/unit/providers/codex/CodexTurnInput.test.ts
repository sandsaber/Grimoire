import path from 'node:path';

import {
  buildCodexTurnInput,
  buildCodexTurnParameters,
  type CodexAttachmentScratch,
  resolveCodexServiceTier,
} from '@/providers/codex/execution/CodexTurnInput';
import { CODEX_SPARK_MODEL, DEFAULT_CODEX_PRIMARY_MODEL, FAST_TIER_CODEX_MODEL } from '@/providers/codex/types/models';

// The reasoning summary is read through the provider settings, which key
// host-specific entries by an opaque device id that only a renderer can supply.
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'host-a',
  getLegacyHostnameKey: () => 'legacy-host',
}));

/**
 * What a Codex turn carries and what it asks the model to be.
 *
 * Both halves lived inside the legacy runtime with no direct test: the input
 * bundle writes real files to a real temp directory and could only be reached by
 * driving a whole turn through a daemon, and the parameters decide plan mode,
 * effort, tier and reasoning — the settings the user set and expects to see
 * honoured on the very next turn.
 */
describe('Codex turn input', () => {
  function recordingScratch(): {
    readonly scratch: CodexAttachmentScratch;
    readonly created: string[];
    readonly written: Map<string, Buffer>;
    readonly removed: string[];
  } {
    const created: string[] = [];
    const written = new Map<string, Buffer>();
    const removed: string[] = [];
    let counter = 0;
    return {
      created,
      written,
      removed,
      scratch: {
        createDirectory: () => {
          counter += 1;
          const directory = path.join(path.sep, 'scratch', String(counter));
          created.push(directory);
          return directory;
        },
        writeFile: (hostPath, data) => {
          written.set(hostPath, data);
        },
        removeDirectory: hostPath => {
          removed.push(hostPath);
        },
      },
    };
  }

  const identityTarget = (hostPath: string): string | null => hostPath;

  it('sends the images first, then the prompt, then the skills', () => {
    // Order is the whole contract of the bundle: Codex reads the images as
    // context for the text that follows, and a prompt placed before them
    // describes attachments the model has not seen yet.
    const { scratch, created } = recordingScratch();

    const bundle = buildCodexTurnInput({
      text: 'describe these',
      images: [
        { data: Buffer.from('one').toString('base64'), mediaType: 'image/png' },
        { data: Buffer.from('two').toString('base64'), mediaType: 'image/jpeg' },
      ],
      skills: [{ type: 'skill', name: 'review', path: '/vault/.codex/skills/review' }],
      toTargetPath: identityTarget,
      scratch,
    });

    expect(bundle.input).toEqual([
      { type: 'localImage', path: path.join(created[0], '1-image-1.png') },
      { type: 'localImage', path: path.join(created[0], '2-image-2.jpg') },
      { type: 'text', text: 'describe these', text_elements: [] },
      { type: 'skill', name: 'review', path: '/vault/.codex/skills/review' },
    ]);
  });

  it('writes each attachment decoded, under the name the chat surface gave it', () => {
    const { scratch, created, written } = recordingScratch();

    const bundle = buildCodexTurnInput({
      text: '',
      images: [
        // `name` is the field on the attachment the composer builds; a builder
        // that reads anything else silently names every image after its index.
        { data: Buffer.from('payload').toString('base64'), mediaType: 'image/png', name: 'my diagram' },
      ],
      toTargetPath: identityTarget,
      scratch,
    });

    // The space is not a path separator anywhere Codex might run, and the
    // extension is what tells the daemon how to read the bytes.
    const expected = path.join(created[0], '1-my_diagram.png');
    expect(bundle.input).toEqual([{ type: 'localImage', path: expected }]);
    expect(written.get(expected)?.toString()).toBe('payload');
  });

  it('leaves out an attachment that is not an image at all', () => {
    const { scratch } = recordingScratch();

    const bundle = buildCodexTurnInput({
      text: 'read this',
      images: [
        { data: Buffer.from('pdf').toString('base64'), mediaType: 'application/pdf', name: 'notes.pdf' },
      ],
      toTargetPath: identityTarget,
      scratch,
    });

    expect(bundle.input).toEqual([{ type: 'text', text: 'read this', text_elements: [] }]);
  });

  it('leaves out an attachment whose bytes never arrived', () => {
    // An attachment stored in the vault carries no bytes until it is hydrated.
    // One that could not be - its file is gone - would otherwise be written as
    // a zero-byte file and handed to Codex as though it were an image.
    const { scratch, written } = recordingScratch();

    const bundle = buildCodexTurnInput({
      text: 'look',
      images: [
        { data: '', mediaType: 'image/png', name: 'gone.png' },
        { data: Buffer.from('one').toString('base64'), mediaType: 'image/png', name: 'here.png' },
      ],
      toTargetPath: identityTarget,
      scratch,
    });

    expect(written.size).toBe(1);
    expect(bundle.input.filter(element => element.type === 'localImage')).toHaveLength(1);
  });

  it('asks for no scratch directory when the turn carries no images', () => {
    const { scratch, created } = recordingScratch();

    const bundle = buildCodexTurnInput({ text: 'plain', toTargetPath: identityTarget, scratch });

    expect(created).toEqual([]);
    expect(bundle.input).toEqual([{ type: 'text', text: 'plain', text_elements: [] }]);
  });

  it('sends nothing for an empty prompt rather than an empty text element', () => {
    const { scratch } = recordingScratch();

    expect(buildCodexTurnInput({ text: '', toTargetPath: identityTarget, scratch }).input).toEqual([]);
  });

  it('raises, and takes the scratch directory with it, when the target cannot see an image', () => {
    // Silently dropping it would send a prompt that talks about a picture the
    // model was never given, which reads as the model ignoring the attachment.
    const { scratch, created, removed } = recordingScratch();

    expect(() => buildCodexTurnInput({
      text: 'look',
      images: [{ data: Buffer.from('one').toString('base64'), mediaType: 'image/png' }],
      toTargetPath: () => null,
      scratch,
    })).toThrow(/cannot access image attachment path/);

    expect(removed).toEqual([created[0]]);
  });

  it('maps the written paths into the terms of the target that will read them', () => {
    const { scratch, created } = recordingScratch();

    const bundle = buildCodexTurnInput({
      text: '',
      images: [{ data: Buffer.from('one').toString('base64'), mediaType: 'image/png' }],
      toTargetPath: hostPath => `/mnt/host${hostPath}`,
      scratch,
    });

    expect(bundle.input).toEqual([
      { type: 'localImage', path: `/mnt/host${path.join(created[0], '1-image-1.png')}` },
    ]);
  });

  it('discards the scratch directory once, however often cleanup is called', () => {
    const { scratch, created, removed } = recordingScratch();

    const bundle = buildCodexTurnInput({
      text: '',
      images: [{ data: Buffer.from('one').toString('base64'), mediaType: 'image/png' }],
      toTargetPath: identityTarget,
      scratch,
    });

    bundle.cleanup();
    bundle.cleanup();

    expect(removed).toEqual([created[0]]);
  });
});

describe('Codex turn parameters', () => {
  function settings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      permissionMode: 'default',
      effortLevel: 'medium',
      serviceTier: 'standard',
      providerConfigs: { codex: { reasoningSummary: 'detailed' } },
      ...overrides,
    };
  }

  it('asks for plan mode exactly when the conversation is in it', () => {
    expect(buildCodexTurnParameters({
      settings: settings({ permissionMode: 'plan' }),
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      orchestratorMode: false,
      baseInstructionsAlreadySent: false,
    }).collaborationMode.mode).toBe('plan');

    expect(buildCodexTurnParameters({
      settings: settings({ permissionMode: 'full_access' }),
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      orchestratorMode: false,
      baseInstructionsAlreadySent: false,
    }).collaborationMode.mode).toBe('default');
  });

  it('carries the orchestrator instructions only where this query has not already sent them', () => {
    // They ride on the thread's base instructions when a thread is started or
    // resumed; repeating them on the turn would state the worker-plan rules
    // twice in one conversation.
    const withInstructions = buildCodexTurnParameters({
      settings: settings(),
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      orchestratorMode: true,
      baseInstructionsAlreadySent: false,
    });
    expect(withInstructions.collaborationMode.settings.developer_instructions)
      .toContain('Grimoire Parallel Workers Mode');

    expect(buildCodexTurnParameters({
      settings: settings(),
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      orchestratorMode: true,
      baseInstructionsAlreadySent: true,
    }).collaborationMode.settings.developer_instructions).toBeNull();

    expect(buildCodexTurnParameters({
      settings: settings(),
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      orchestratorMode: false,
      baseInstructionsAlreadySent: false,
    }).collaborationMode.settings.developer_instructions).toBeNull();
  });

  it('passes a known effort through and falls back to medium for anything else', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh']) {
      const parameters = buildCodexTurnParameters({
        settings: settings({ effortLevel: level }),
        model: DEFAULT_CODEX_PRIMARY_MODEL,
        orchestratorMode: false,
        baseInstructionsAlreadySent: false,
      });
      expect(parameters.effort).toBe(level);
      expect(parameters.collaborationMode.settings.reasoning_effort).toBe(level);
    }

    expect(buildCodexTurnParameters({
      settings: settings({ effortLevel: 'ludicrous' }),
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      orchestratorMode: false,
      baseInstructionsAlreadySent: false,
    }).effort).toBe('medium');
  });

  it('names the model the turn actually runs on, defaulting where the caller has none', () => {
    const parameters = buildCodexTurnParameters({
      settings: settings(),
      model: undefined,
      orchestratorMode: false,
      baseInstructionsAlreadySent: false,
    });

    expect(parameters.model).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
    expect(parameters.collaborationMode.settings.model).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
  });

  it('reads the reasoning summary from settings, and refuses it on the model that has none', () => {
    expect(buildCodexTurnParameters({
      settings: settings({ providerConfigs: { codex: { reasoningSummary: 'concise' } } }),
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      orchestratorMode: false,
      baseInstructionsAlreadySent: false,
    }).summary).toBe('concise');

    expect(buildCodexTurnParameters({
      settings: settings({ providerConfigs: { codex: { reasoningSummary: 'detailed' } } }),
      model: CODEX_SPARK_MODEL,
      orchestratorMode: false,
      baseInstructionsAlreadySent: false,
    }).summary).toBe('none');
  });

  it('asks for the fast tier only on the model that has one', () => {
    expect(resolveCodexServiceTier('fast', FAST_TIER_CODEX_MODEL)).toBe('fast');
    expect(resolveCodexServiceTier('standard', FAST_TIER_CODEX_MODEL)).toBeNull();
    expect(resolveCodexServiceTier('fast', CODEX_SPARK_MODEL)).toBeNull();
    expect(resolveCodexServiceTier('fast', undefined)).toBeNull();

    expect(buildCodexTurnParameters({
      settings: settings({ serviceTier: 'fast' }),
      model: FAST_TIER_CODEX_MODEL,
      orchestratorMode: false,
      baseInstructionsAlreadySent: false,
    }).serviceTier).toBe('fast');
  });
});
