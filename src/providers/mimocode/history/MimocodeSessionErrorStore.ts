
type StoredErrorRow = Record<string, unknown>;

export interface MimocodeSessionError {
  message: string;
  name?: string;
  statusCode?: number;
}

const MAX_ERROR_MESSAGE_LENGTH = 600;

export function extractMimocodeSessionErrorFromMessage(
  message: StoredErrorRow,
): MimocodeSessionError | null {
  const error = getObject(message.error);
  const errorData = getObject(error?.data);
  const rawMessage = getString(errorData?.message) ?? getString(error?.message);
  if (!rawMessage) {
    return null;
  }

  return {
    message: truncateMessage(rawMessage),
    ...(getString(error?.name) ? { name: getString(error?.name)! } : {}),
    ...(getNumber(errorData?.statusCode) !== null
      ? { statusCode: getNumber(errorData?.statusCode)! }
      : {}),
  };
}

export function formatMimocodeSessionError(error: MimocodeSessionError): string {
  if (error.statusCode === 401 || /invalid api key|invalid[_ -]?key/i.test(error.message)) {
    return 'MiMo authentication failed: Invalid API Key. Run `mimo auth login` in a terminal, then retry.';
  }

  return `MiMo request failed: ${error.message}`;
}

function truncateMessage(message: string): string {
  const normalized = message.trim();
  return normalized.length <= MAX_ERROR_MESSAGE_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}…`;
}


function getObject(value: unknown): StoredErrorRow | null {
  return isPlainObject(value) ? value : null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isPlainObject(value: unknown): value is StoredErrorRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
