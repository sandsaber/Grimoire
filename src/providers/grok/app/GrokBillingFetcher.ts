import * as fs from 'node:fs/promises';
import * as https from 'node:https';

import type { ProviderPlanUsageWindow } from '../../../core/providers/types';
import { isRecord } from '../../../utils/records';
import { resolveGrokAuthPath } from '../runtime/GrokPaths';

const GROK_CREDITS_CONFIG_URL = 'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig';
const GROK_CREDITS_USAGE_URL = 'https://grok.com/?_s=usage';
const GROK_UNIFIED_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';

export interface GrokCreditsUsageSnapshot {
  plan: string;
  note?: string;
  windows: ProviderPlanUsageWindow[];
}

export function parseGrokBillingResponse(payload: unknown): GrokCreditsUsageSnapshot | null {
  if (!isRecord(payload) || !isRecord(payload.config)) {
    return null;
  }

  const config = payload.config;
  const currentPeriod = isRecord(config.currentPeriod) ? config.currentPeriod : null;
  const resetAt = readDate(currentPeriod?.end) ?? readDate(config.billingPeriodEnd);
  if (!resetAt) {
    return null;
  }

  const reportedUsagePercent = readFiniteNumber(config.creditUsagePercent);
  const usagePercent = reportedUsagePercent
    ?? (config.isUnifiedBillingUser === true && currentPeriod ? 0 : null);
  if (usagePercent === null) {
    return null;
  }

  const periodType = readString(currentPeriod?.type);
  const label = periodType === 'USAGE_PERIOD_TYPE_WEEKLY'
    ? 'Weekly'
    : periodType === 'USAGE_PERIOD_TYPE_MONTHLY'
      ? 'Monthly'
      : 'Credits';
  const prepaidBalance = readAmount(config.prepaidBalance);
  const noteParts = [
    currentPeriod ? 'Shared across Grok products' : 'Grok credits',
    ...(prepaidBalance !== null && prepaidBalance > 0
      ? [`Extra credits: $${prepaidBalance.toFixed(2)}`]
      : []),
    GROK_CREDITS_USAGE_URL,
  ];

  return {
    plan: normalizePlanName(readString(payload.subscription_tier) ?? readString(payload.subscriptionTier)),
    note: noteParts.join(' · '),
    windows: [{
      label,
      pct: Math.min(100, Math.max(0, Math.round(usagePercent))),
      pctKnown: true,
      reset: formatResetLabel(resetAt),
    }],
  };
}

export function parseGrokCreditsConfigMessage(message: Uint8Array): GrokCreditsUsageSnapshot | null {
  const usagePercent = readCreditUsagePercent(message);
  const resetAt = readBillingPeriodEnd(message);
  if (usagePercent === null || !resetAt) {
    return null;
  }

  return {
    plan: 'SuperGrok',
    note: `Free credits · resets ${formatResetLabel(resetAt)} · ${GROK_CREDITS_USAGE_URL}`,
    windows: [{
      label: 'Credits',
      pct: Math.min(100, Math.max(0, Math.round(usagePercent))),
      pctKnown: true,
      reset: formatResetLabel(resetAt),
    }],
  };
}

export async function fetchGrokCreditsUsage(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GrokCreditsUsageSnapshot | null> {
  const token = await readGrokAuthBearerToken(env);
  if (!token) {
    return null;
  }

  const unifiedBilling = await requestGrokUnifiedBilling(token);
  const unifiedUsage = parseGrokBillingResponse(unifiedBilling);
  if (unifiedUsage) {
    return unifiedUsage;
  }

  const response = await requestGrokCreditsConfig(token);
  if (!response) {
    return null;
  }

  return parseGrokCreditsConfigMessage(response);
}

async function readGrokAuthBearerToken(env: NodeJS.ProcessEnv): Promise<string | null> {
  const authPath = resolveGrokAuthPath(env);
  try {
    const raw = await fs.readFile(authPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key.includes('auth.x.ai') || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }

      const token = (entry as Record<string, unknown>).key;
      return typeof token === 'string' && token.trim() ? token.trim() : null;
    }
  } catch {
    return null;
  }

  return null;
}

async function requestGrokUnifiedBilling(token: string): Promise<unknown> {
  try {
    const body = await getHttpsText(GROK_UNIFIED_BILLING_URL, {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': 'Grimoire',
      'x-grok-client-mode': 'interactive',
      'x-xai-token-auth': 'xai-grok-cli',
    });
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

async function requestGrokCreditsConfig(token: string): Promise<Uint8Array | null> {
  try {
    const buffer = await postHttpsBinary(GROK_CREDITS_CONFIG_URL, new Uint8Array([0, 0, 0, 0, 0]), {
      accept: '*/*',
      authorization: `Bearer ${token}`,
      'content-type': 'application/grpc-web+proto',
      origin: 'https://grok.com',
      referer: GROK_CREDITS_USAGE_URL,
      'user-agent': 'Grimoire',
      'x-grpc-web': '1',
    });
    const trailerIndex = indexOfAscii(buffer, 'grpc-status');
    const frame = trailerIndex >= 0 ? buffer.slice(0, trailerIndex) : buffer;
    if (frame.length < 5) {
      return null;
    }

    const messageLength = readUInt32BE(frame, 1);
    const message = frame.slice(5, 5 + messageLength);
    return message.length > 0 ? message : null;
  } catch {
    return null;
  }
}

function postHttpsBinary(
  url: string,
  body: Uint8Array,
  headers: Record<string, string>,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      headers: {
        ...headers,
        'content-length': String(body.byteLength),
      },
      method: 'POST',
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Grok billing request failed with status ${statusCode}`));
          return;
        }

        resolve(new Uint8Array(Buffer.concat(chunks)));
      });
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function getHttpsText(
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      headers,
      method: 'GET',
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Grok billing request failed with status ${statusCode}`));
          return;
        }

        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });

    request.on('error', reject);
    request.end();
  });
}

function readCreditUsagePercent(message: Uint8Array): number | null {
  const fields = parseProtobuf(message);
  for (const field of fields) {
    if (field.fieldNumber === 1 && field.wireType === 'fixed32' && typeof field.value === 'number') {
      return field.value;
    }

    if (field.fieldNumber === 1 && field.wireType === 'bytes' && field.value instanceof Uint8Array) {
      for (const nestedField of parseProtobuf(field.value)) {
        if (nestedField.fieldNumber === 1 && nestedField.wireType === 'fixed32' && typeof nestedField.value === 'number') {
          return nestedField.value;
        }
      }
    }
  }

  return null;
}

function readBillingPeriodEnd(message: Uint8Array): Date | null {
  const fields = parseProtobuf(message);
  for (const field of fields) {
    if (field.fieldNumber !== 1 || field.wireType !== 'bytes' || !(field.value instanceof Uint8Array)) {
      continue;
    }

    const nested = parseProtobuf(field.value);
    for (const nestedField of nested) {
      if (nestedField.fieldNumber === 8 && nestedField.wireType === 'bytes' && nestedField.value instanceof Uint8Array) {
        const cycle = parseProtobuf(nestedField.value);
        for (const cycleField of cycle) {
          if (cycleField.fieldNumber === 3 && cycleField.wireType === 'bytes' && cycleField.value instanceof Uint8Array) {
            const timestamp = readTimestampSeconds(cycleField.value);
            if (timestamp) {
              return timestamp;
            }
          }
        }
      }

      if (nestedField.fieldNumber === 5 && nestedField.wireType === 'bytes' && nestedField.value instanceof Uint8Array) {
        const timestamp = readTimestampSeconds(nestedField.value);
        if (timestamp) {
          return timestamp;
        }
      }
    }
  }

  return null;
}

function readTimestampSeconds(message: Uint8Array): Date | null {
  for (const field of parseProtobuf(message)) {
    if (field.fieldNumber === 1 && field.wireType === 'varint' && typeof field.value === 'number') {
      return new Date(field.value * 1000);
    }
  }

  return null;
}

interface ProtobufField {
  fieldNumber: number;
  value: number | Uint8Array;
  wireType: 'varint' | 'fixed32' | 'bytes';
}

function parseProtobuf(buffer: Uint8Array): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const keyResult = readVarint(buffer, offset);
    if (!keyResult) {
      break;
    }

    const key = keyResult.value;
    offset = keyResult.nextOffset;
    const fieldNumber = key >> 3;
    const wireType = key & 0x07;

    if (wireType === 0) {
      const valueResult = readVarint(buffer, offset);
      if (!valueResult) {
        break;
      }

      fields.push({
        fieldNumber,
        value: valueResult.value,
        wireType: 'varint',
      });
      offset = valueResult.nextOffset;
      continue;
    }

    if (wireType === 5) {
      if (offset + 4 > buffer.length) {
        break;
      }

      const value = readFloat32LE(buffer, offset);
      fields.push({
        fieldNumber,
        value,
        wireType: 'fixed32',
      });
      offset += 4;
      continue;
    }

    if (wireType === 2) {
      const lengthResult = readVarint(buffer, offset);
      if (!lengthResult) {
        break;
      }

      offset = lengthResult.nextOffset;
      const length = lengthResult.value;
      if (offset + length > buffer.length) {
        break;
      }

      fields.push({
        fieldNumber,
        value: buffer.slice(offset, offset + length),
        wireType: 'bytes',
      });
      offset += length;
      continue;
    }

    break;
  }

  return fields;
}

function readVarint(
  buffer: Uint8Array,
  offset: number,
): { nextOffset: number; value: number } | null {
  let value = 0;
  let shift = 0;
  let index = offset;

  while (index < buffer.length) {
    const byte = buffer[index];
    index += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { nextOffset: index, value };
    }

    shift += 7;
    if (shift > 35) {
      return null;
    }
  }

  return null;
}

function readFloat32LE(buffer: Uint8Array, offset: number): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
  return view.getFloat32(0, true);
}

function readUInt32BE(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] << 24)
    | (buffer[offset + 1] << 16)
    | (buffer[offset + 2] << 8)
    | buffer[offset + 3]
  ) >>> 0;
}

function indexOfAscii(buffer: Uint8Array, needle: string): number {
  const ascii = new TextEncoder().encode(needle);
  outer: for (let index = 0; index <= buffer.length - ascii.length; index += 1) {
    for (let offset = 0; offset < ascii.length; offset += 1) {
      if (buffer[index + offset] !== ascii[offset]) {
        continue outer;
      }
    }

    return index;
  }

  return -1;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readAmount(value: unknown): number | null {
  if (isRecord(value)) {
    return readFiniteNumber(value.val);
  }
  return readFiniteNumber(value);
}

function readDate(value: unknown): Date | null {
  const text = readString(value);
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePlanName(value: string | null): string {
  if (!value) {
    return 'Grok Build';
  }

  const knownPlans: Record<string, string> = {
    supergrok: 'SuperGrok',
    supergrok_heavy: 'SuperGrok Heavy',
    supergrok_lite: 'SuperGrok Lite',
    x_basic: 'X Basic',
    x_premium: 'X Premium',
    x_premium_plus: 'X Premium+',
  };
  return knownPlans[value.toLowerCase()] ?? value;
}

function formatResetLabel(value: Date): string {
  return value.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
