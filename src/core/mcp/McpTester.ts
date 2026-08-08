import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport';
import * as http from 'http';
import * as https from 'https';

import { getEnhancedPath } from '../../utils/env';
import { parseCommand } from '../../utils/mcp';
import type {
  ManagedMcpServer,
  McpHttpServerConfig,
  McpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../types';
import { getMcpServerType } from '../types';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpTestResult {
  success: boolean;
  serverName?: string;
  serverVersion?: string;
  tools: McpTool[];
  error?: string;
}

type StreamableHttpTransportOptions = ConstructorParameters<typeof StreamableHTTPClientTransport>[1];

function createLegacySseTransport(url: URL, options: StreamableHttpTransportOptions): Transport {
  // Legacy SSE MCP servers still need the SDK's optional deprecated transport export.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-type-assertion -- dynamic optional SDK export
  const module = require('@modelcontextprotocol/sdk/client/sse') as {
    SSEClientTransport: new (endpoint: URL, opts?: StreamableHttpTransportOptions) => Transport;
  };
  return new module.SSEClientTransport(url, options);
}

/**
 * Use Node's HTTP stack for MCP server verification to avoid renderer CORS restrictions.
 * We still rely on official SDK transports for MCP protocol semantics.
 */
export function createNodeFetch(): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = getRequestUrl(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = mergeHeaders(input, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const body = await getRequestBody(init?.body ?? (input instanceof Request ? input.body : undefined));
    const transport = requestUrl.protocol === 'https:' ? https : http;

    return new Promise<Response>((resolve, reject) => {
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const onAbort = () => {
        req.destroy(new Error('Request aborted'));
        fail(signal?.reason ?? new Error('Request aborted'));
      };

      const requestHeaders: Record<string, string> = {};
      headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
      if (body) {
        requestHeaders['content-length'] = String(body.byteLength);
      }

      const req = transport.request(
        requestUrl,
        {
          method,
          headers: requestHeaders,
        },
        (res: http.IncomingMessage) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(createFetchResponse(res));
        },
      );

      req.on('error', (error: Error) => fail(error));

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      if (body) {
        req.end(body);
      } else {
        req.end();
      }
    });
  };
}

function createFetchResponse(res: http.IncomingMessage): Response {
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const headerValue of value) {
        responseHeaders.append(key, headerValue);
      }
    } else {
      responseHeaders.append(key, value);
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      res.on('data', (chunk: Buffer | string) => {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buffer));
      });
      res.on('end', () => controller.close());
      res.on('error', (error: Error) => controller.error(error));
    },
    cancel(reason?: unknown) {
      res.destroy(reason instanceof Error ? reason : new Error('Response body cancelled'));
    },
  });

  return new Response(body, {
    status: res.statusCode ?? 500,
    statusText: res.statusMessage ?? '',
    headers: responseHeaders,
  });
}

function getRequestUrl(input: string | URL | Request): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === 'string') {
    return new URL(input);
  }
  return new URL(input.url);
}

function mergeHeaders(input: string | URL | Request, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    const initHeaders = new Headers(init.headers);
    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

async function getRequestBody(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (body === undefined || body === null) {
    return undefined;
  }

  const serialized = await new Response(body).arrayBuffer();
  return Buffer.from(serialized);
}

const nodeFetch = createNodeFetch();

function isStdioServerConfig(config: McpServerConfig): config is McpStdioServerConfig {
  return 'command' in config && typeof config.command === 'string';
}

function isUrlServerConfig(
  config: McpServerConfig,
): config is McpSSEServerConfig | McpHttpServerConfig {
  return 'url' in config && typeof config.url === 'string';
}

export async function testMcpServer(server: ManagedMcpServer): Promise<McpTestResult> {
  const type = getMcpServerType(server.config);

  let transport: Transport;
  try {
    if (type === 'stdio') {
      if (!isStdioServerConfig(server.config)) {
        return { success: false, tools: [], error: 'Missing command' };
      }
      const config = server.config;
      const { cmd, args } = parseCommand(config.command, config.args);
      if (!cmd) {
        return { success: false, tools: [], error: 'Missing command' };
      }
      transport = new StdioClientTransport({
        command: cmd,
        args,
        env: { ...process.env, ...config.env, PATH: getEnhancedPath(config.env?.PATH) },
        stderr: 'ignore',
      });
    } else {
      if (!isUrlServerConfig(server.config)) {
        return { success: false, tools: [], error: 'Invalid server configuration' };
      }
      const config = server.config;
      const url = new URL(config.url);
      const options = {
        fetch: nodeFetch,
        requestInit: config.headers ? { headers: config.headers } : undefined,
      };
      transport = type === 'sse'
        ? createLegacySseTransport(url, options)
        : new StreamableHTTPClientTransport(url, options);
    }
  } catch (error) {
    return {
      success: false,
      tools: [],
      error: error instanceof Error ? error.message : 'Invalid server configuration',
    };
  }

  const client = new Client({ name: 'grimoire-tester', version: '1.0.0' });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    await client.connect(transport, { signal: controller.signal });

    const serverVersion = client.getServerVersion();
    let tools: McpTool[] = [];
    try {
      const result = await client.listTools(undefined, { signal: controller.signal });
      tools = result.tools.map((tool) => {
        const inputSchema = tool.inputSchema;
        return {
          name: tool.name,
          description: tool.description,
          ...(inputSchema && typeof inputSchema === 'object' && !Array.isArray(inputSchema)
            ? { inputSchema: { ...inputSchema } }
            : {}),
        };
      });
    } catch {
      // listTools failure after successful connect = partial success
    }

    return {
      success: true,
      serverName: serverVersion?.name,
      serverVersion: serverVersion?.version,
      tools,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return { success: false, tools: [], error: 'Connection timeout (10s)' };
    }
    return {
      success: false,
      tools: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    window.clearTimeout(timeout);
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }
}
