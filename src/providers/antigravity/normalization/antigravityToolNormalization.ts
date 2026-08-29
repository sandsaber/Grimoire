import {
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';

/**
 * agy names its tools and their arguments in its own vocabulary. Mapping them
 * onto the neutral names here is what earns an agy call the same card as any
 * other provider's - icon, header and diff rendering all key off these - and it
 * keeps the vocabulary inside the provider, where the shared chat rendering
 * never has to learn a second set of parameter names.
 *
 * Only tools whose native name is confirmed against the CLI are mapped; an
 * unmapped tool keeps its agy name and simply renders as itself.
 */
const TOOL_NAME_MAP: Record<string, string> = {
  edit_file: TOOL_EDIT,
  find_by_name: TOOL_GLOB,
  grep_search: TOOL_GREP,
  list_dir: TOOL_LS,
  list_directory: TOOL_LS,
  read_url_content: TOOL_WEB_FETCH,
  replace_file_content: TOOL_EDIT,
  run_command: TOOL_BASH,
  search_web: TOOL_WEB_SEARCH,
  view_file: TOOL_READ,
  write_to_file: TOOL_WRITE,
};

/**
 * agy's PascalCase argument names next to the neutral keys the shared renderer
 * reads. Applied to every agy tool, mapped or not, so a tool this table does
 * not know about still shows what it is acting on.
 */
const TOOL_INPUT_KEY_MAP: Record<string, string> = {
  AbsolutePath: 'file_path',
  CodeContent: 'content',
  CommandLine: 'command',
  DirectoryPath: 'path',
  Query: 'query',
  SearchDirectory: 'path',
  SearchPath: 'path',
  TargetFile: 'file_path',
  Url: 'url',
};

/** agy's `grep_search` names its needle `Query`; the neutral Grep key is `pattern`. */
const TOOL_INPUT_KEY_OVERRIDES: Record<string, Record<string, string>> = {
  find_by_name: { Pattern: 'pattern', Query: 'pattern' },
  grep_search: { Query: 'pattern' },
};

export function normalizeAntigravityToolName(toolName: string): string {
  return TOOL_NAME_MAP[toolName] ?? toolName;
}

export function normalizeAntigravityToolInput(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const overrides = TOOL_INPUT_KEY_OVERRIDES[toolName];
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const neutralKey = overrides?.[key] ?? TOOL_INPUT_KEY_MAP[key];
    // The native key is kept alongside the neutral one: agy's own argument
    // names are what its transcripts and logs show, and dropping them would
    // make a card impossible to line up against the CLI's own output.
    normalized[key] = value;
    if (neutralKey && !(neutralKey in input)) {
      normalized[neutralKey] = value;
    }
  }

  return normalized;
}
