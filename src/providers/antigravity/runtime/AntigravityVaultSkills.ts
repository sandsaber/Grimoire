import { XML_CONTEXT_PATTERN } from '../../../utils/context';

/**
 * Where a vault skill's body is read from.
 *
 * Narrowed to the one method this needs rather than taking the command catalog:
 * the expansion is a text transform, and a text transform that could also
 * delete a vault entry is a wider thing than it looks.
 */
export interface AntigravityVaultSkillSource {
  listVaultEntries(): Promise<readonly { readonly name: string; readonly content?: string }[]>;
}

/**
 * Turns `/skill args` into the skill's own instructions.
 *
 * **`agy --print` has no slash commands.** Every other provider resolves an
 * invocation through its own session; print mode has no session to resolve it
 * in, so a prompt beginning with `/researcher` reaches the CLI as the literal
 * text `/researcher` and the agent is left to guess (#58). Expanding it here is
 * what makes a vault skill mean anything to this provider.
 *
 * The context tail is preserved and never searched: `<current_note>` and its
 * siblings are appended after the user's words, and a skill invocation is only
 * ever the first thing a person typed.
 */
export async function expandAntigravityVaultSkillInvocation(
  prompt: string,
  skills: AntigravityVaultSkillSource | null,
): Promise<string> {
  if (!skills) {
    return prompt;
  }
  const { userText, contextTail } = splitPromptXmlContext(prompt);
  const match = /^\/([\p{L}\p{N}_-]+)(?:\s|$)([\s\S]*)$/u.exec(userText);
  if (!match) {
    return prompt;
  }
  const [, skillName, argumentsText] = match;
  const body = await findVaultSkill(skills, skillName ?? '');
  if (!body) {
    return prompt;
  }
  const expanded = [
    `You are executing the vault skill "${skillName}". Follow its instructions.`,
    '',
    body,
    argumentsText?.trim()
      ? `\nUser input for this skill:\n${argumentsText.trim()}`
      : '',
  ].join('\n').trimEnd();
  return contextTail ? `${expanded}${contextTail}` : expanded;
}

function splitPromptXmlContext(prompt: string): { userText: string; contextTail: string } {
  const xmlMatch = XML_CONTEXT_PATTERN.exec(prompt);
  if (xmlMatch?.index === undefined) {
    return { userText: prompt, contextTail: '' };
  }
  return {
    userText: prompt.slice(0, xmlMatch.index),
    contextTail: prompt.slice(xmlMatch.index),
  };
}

async function findVaultSkill(
  skills: AntigravityVaultSkillSource,
  skillName: string,
): Promise<string | null> {
  try {
    const entries = await skills.listVaultEntries();
    const entry = entries.find(candidate => (
      candidate.name.toLowerCase() === skillName.toLowerCase()
    ));
    return entry?.content?.trim() ? entry.content : null;
  } catch {
    // A vault that cannot be listed is a prompt that goes as the person typed
    // it. Failing the turn over a skill lookup would be a worse answer than
    // sending the literal text.
    return null;
  }
}
