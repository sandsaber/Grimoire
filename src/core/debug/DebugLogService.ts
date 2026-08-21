import { GRIMOIRE_STORAGE_PATH } from '../bootstrap/StoragePaths';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';

export const GRIMOIRE_DEBUG_LOGS_PATH = `${GRIMOIRE_STORAGE_PATH}/logs`;

export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugLogEvent {
  data?: Record<string, unknown>;
  error?: unknown;
  event: string;
  level?: DebugLogLevel;
  scope: string;
}

type DebugLogServiceOptions = {
  now?: () => Date;
};

const REDACTED = '[redacted]';
const REDACTED_STRING = '[redacted-string]';
const MAX_STRING_LENGTH = 240;
const MAX_DEPTH = 6;

const SENSITIVE_KEY_PATTERN =
  /(authorization|bearer|body|clipboard|content|cookie|env|file|header|input|key|message|note|output|password|path|prompt|request|response|secret|selection|text|token|transcript)/i;

const SAFE_STRING_KEY_PATTERN =
  /^(account|argsSummary|code|command|commandSource|cwdLabel|errorCode|errorName|errorSummary|event|homePresent|killSignal|label|launchMode|level|messageType|method|mode|model|pathEntryCount|pathHasLocalBin|phase|plan|promptLength|provider|providerId|rateLimitInfoFields|rateLimitType|reason|reset|runtime|scope|shellPresent|signal|source|state|status|stderrPreview|stdinMode|stdioMode|usageKind|window|windowLabel)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}

function truncate(value: string): string {
  return value.length <= MAX_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_STRING_LENGTH)}...`;
}

function redactSensitiveText(value: string): string {
  return truncate(value)
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]')
    .replace(/\b(?:sk|rk|pk|api|key|token)[-_][A-Za-z0-9._-]{8,}\b/gi, '[redacted-secret]')
    // D7 forbids absolute paths outside the vault. The list used to be
    // macOS-and-Windows — `/Users`, `/Volumes`, `/private`, `/tmp`, `/var` — so
    // on Linux a home directory went into the log verbatim, most often through
    // a CLI's own stderr.
    .replace(
      /(?:\/(?:Users|Volumes|private|tmp|var|home|root|opt|srv|mnt|media|etc|usr)\/|[A-Za-z]:\\)[^\s"'`]+/g,
      '[redacted-path]',
    );
}

function sanitizeIdentifier(value: string, fallback: string): string {
  const cleaned = redactSensitiveText(value).trim();
  if (!cleaned || cleaned.includes(REDACTED)) {
    return fallback;
  }
  return truncate(cleaned.replace(/\s+/g, '.'));
}

function sanitizeDebugValue(value: unknown, key: string | null, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return '[truncated]';
  }

  if (key && SENSITIVE_KEY_PATTERN.test(key) && !SAFE_STRING_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (value === null || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string') {
    if (!key || !SAFE_STRING_KEY_PATTERN.test(key)) {
      return REDACTED_STRING;
    }
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .map(item => sanitizeDebugValue(item, null, depth + 1))
      .filter(item => item !== undefined);
    return sanitized;
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const sanitized = sanitizeDebugValue(entryValue, entryKey, depth + 1);
      if (sanitized !== undefined) {
        result[entryKey] = sanitized;
      }
    }
    return result;
  }

  return undefined;
}

function sanitizeDebugError(error: unknown): Record<string, unknown> | undefined {
  if (!error) {
    return undefined;
  }

  if (error instanceof Error) {
    const details: Record<string, unknown> = {
      errorName: error.name || 'Error',
    };
    if (error.message) {
      details.errorSummary = redactSensitiveText(error.message);
    }
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') {
      details.errorCode = String(code);
    }
    return details;
  }

  if (typeof error === 'string') {
    return { errorName: 'Error', errorSummary: redactSensitiveText(error) };
  }

  return { errorName: typeof error };
}

export function sanitizeDebugLogData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) {
    return {};
  }

  const sanitized = sanitizeDebugValue(data, null, 0);
  return isRecord(sanitized) ? sanitized : {};
}

export class DebugLogService {
  private now: () => Date;

  constructor(
    private adapter: VaultFileAdapter,
    private isEnabled: () => boolean,
    options: DebugLogServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async write(event: DebugLogEvent): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const now = this.now();
    const entry = {
      data: sanitizeDebugLogData(event.data),
      event: sanitizeIdentifier(event.event, 'event'),
      level: event.level ?? 'debug',
      scope: sanitizeIdentifier(event.scope, 'debug'),
      ts: now.toISOString(),
      ...(event.error ? { error: sanitizeDebugError(event.error) } : {}),
    };
    const path = `${GRIMOIRE_DEBUG_LOGS_PATH}/${formatLocalDate(now)}.jsonl`;

    try {
      await this.adapter.ensureFolder(GRIMOIRE_DEBUG_LOGS_PATH);
      await this.adapter.append(path, `${JSON.stringify(entry)}\n`);
    } catch {
      // Debug logging must never break normal plugin behavior.
    }
  }
}
