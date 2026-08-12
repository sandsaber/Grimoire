import type {
  LocalShellInvocation,
  LocalShellRequestResolver,
} from '../../../core/execution/local/LocalShellBackend';

/** One-shot raw shell inputs. They never enter lifecycle records or diagnostic payloads. */
export class EphemeralLocalShellRequestStore implements LocalShellRequestResolver {
  private readonly requests = new Map<string, LocalShellInvocation>();
  private disposed = false;

  register(requestRef: string, invocation: LocalShellInvocation): void {
    this.requireOpen();
    requireOpaqueRef(requestRef);
    if (this.requests.has(requestRef)) {
      throw new Error('Local shell request reference is already registered.');
    }
    this.requests.set(requestRef, cloneInvocation(invocation));
  }

  async resolve(requestRef: string): Promise<LocalShellInvocation> {
    this.requireOpen();
    const invocation = this.requests.get(requestRef);
    if (!invocation) throw new Error('Local shell request reference is absent or already consumed.');
    this.requests.delete(requestRef);
    return cloneInvocation(invocation);
  }

  forget(requestRef: string): void {
    this.requests.delete(requestRef);
  }

  dispose(): void {
    this.disposed = true;
    this.requests.clear();
  }

  private requireOpen(): void {
    if (this.disposed) throw new Error('Local shell request store is disposed.');
  }
}

function cloneInvocation(invocation: LocalShellInvocation): LocalShellInvocation {
  return {
    command: invocation.command,
    ...(invocation.cwd !== undefined ? { cwd: invocation.cwd } : {}),
    ...(invocation.environment
      ? { environment: { ...invocation.environment } }
      : {}),
  };
}

function requireOpaqueRef(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error('Local shell request reference must be a constrained identifier.');
  }
}
