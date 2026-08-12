import type {
  ExecutionReconciliationRecord,
  ExecutionRunRecord,
} from '../../../core/execution/ExecutionControlRecords';
import type { RunId } from '../../../core/execution/ExecutionIds';
import type { LocalShellOutputObserver } from '../../../core/execution/local/LocalShellBackend';
import {
  createLocalShellProjection,
  type LocalShellProjection,
  reduceLocalShellProjection,
} from '../projections/LocalShellProjection';

interface OutputEntry {
  readonly decoders: Record<'stdout' | 'stderr', TextDecoder>;
  readonly listeners: Set<(projection: LocalShellProjection) => void>;
  projection: LocalShellProjection;
}

export class LocalShellOutputProjectionStore implements LocalShellOutputObserver {
  private readonly entries = new Map<RunId, OutputEntry>();
  private disposed = false;

  open(input: Parameters<typeof createLocalShellProjection>[0]): LocalShellProjection {
    this.requireOpen();
    if (this.entries.has(input.runId)) throw new Error('Local shell projection already exists.');
    const projection = createLocalShellProjection(input);
    this.entries.set(input.runId, {
      projection,
      decoders: { stdout: new TextDecoder(), stderr: new TextDecoder() },
      listeners: new Set(),
    });
    return projection;
  }

  get(runId: RunId): LocalShellProjection | null {
    return this.entries.get(runId)?.projection ?? null;
  }

  remove(runId: RunId): void {
    const entry = this.entries.get(runId);
    if (!entry) return;
    entry.listeners.clear();
    this.entries.delete(runId);
  }

  attach(runId: RunId, listener: (projection: LocalShellProjection) => void): () => void {
    this.requireOpen();
    const entry = this.requireEntry(runId);
    entry.listeners.add(listener);
    listener(entry.projection);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  onStdout(runId: string, chunk: Uint8Array): void {
    this.append(runId, 'stdout', chunk);
  }

  onStderr(runId: string, chunk: Uint8Array): void {
    this.append(runId, 'stderr', chunk);
  }

  onOutputLimit(runId: string): void {
    const entry = this.entries.get(runId as RunId);
    if (!entry) return;
    this.publish(entry, reduceLocalShellProjection(entry.projection, {
      kind: 'output-limit',
      updatedAt: Date.now(),
    }));
  }

  applyRun(record: Readonly<ExecutionRunRecord>, revision: number): void {
    const entry = this.entries.get(record.runId as RunId);
    if (!entry) return;
    if (record.terminal && !entry.projection.terminal) this.flush(entry);
    this.publish(entry, reduceLocalShellProjection(entry.projection, {
      kind: 'run-record',
      record,
      revision,
    }));
  }

  applyReconciliation(record: Readonly<ExecutionReconciliationRecord>): void {
    const entry = this.entries.get(record.runId as RunId);
    if (!entry) return;
    this.publish(entry, reduceLocalShellProjection(entry.projection, {
      kind: 'reconciliation',
      record,
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) entry.listeners.clear();
  }

  private append(runId: string, channel: 'stdout' | 'stderr', chunk: Uint8Array): void {
    if (this.disposed) return;
    const entry = this.entries.get(runId as RunId);
    if (!entry || entry.projection.terminal) return;
    const text = entry.decoders[channel].decode(chunk, { stream: true });
    this.publish(entry, reduceLocalShellProjection(entry.projection, {
      kind: 'output',
      channel,
      text,
      byteLength: chunk.byteLength,
      updatedAt: Date.now(),
    }));
  }

  private flush(entry: OutputEntry): void {
    for (const channel of ['stdout', 'stderr'] as const) {
      const text = entry.decoders[channel].decode();
      if (text.length === 0) continue;
      this.publish(entry, reduceLocalShellProjection(entry.projection, {
        kind: 'output',
        channel,
        text,
        byteLength: 0,
        updatedAt: Date.now(),
      }));
    }
  }

  private publish(entry: OutputEntry, projection: LocalShellProjection): void {
    if (projection === entry.projection) return;
    entry.projection = projection;
    for (const listener of entry.listeners) {
      try {
        listener(projection);
      } catch {
        // A detached or faulty view cannot affect application-owned shell execution.
      }
    }
  }

  private requireEntry(runId: RunId): OutputEntry {
    const entry = this.entries.get(runId);
    if (!entry) throw new Error('Local shell projection is absent.');
    return entry;
  }

  private requireOpen(): void {
    if (this.disposed) throw new Error('Local shell output projection store is disposed.');
  }
}
