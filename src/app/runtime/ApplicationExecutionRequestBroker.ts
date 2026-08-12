import type { ApplicationIdentityFactory } from './ApplicationIdentityFactory';
import type { EphemeralExecutionRequestStore } from './EphemeralExecutionRequestStore';

/** Generates and consumes opaque references for one-shot provider execution inputs. */
export class ApplicationExecutionRequestBroker {
  constructor(
    private readonly requests: EphemeralExecutionRequestStore,
    private readonly identities: Pick<ApplicationIdentityFactory, 'nextRequestRef'>,
  ) {}

  register<TPayload>(kind: string, payload: TPayload): string {
    const requestRef = this.identities.nextRequestRef();
    this.requests.register(requestRef, kind, payload);
    return requestRef;
  }

  resolver<TPayload>(kind: string): { resolve(requestRef: string): Promise<TPayload> } {
    return {
      resolve: async requestRef => this.requests.take<TPayload>(requestRef, kind),
    };
  }

  take<TPayload>(requestRef: string, kind: string): TPayload {
    return this.requests.take<TPayload>(requestRef, kind);
  }

  forget(requestRef: string): void {
    this.requests.forget(requestRef);
  }

  dispose(): void {
    this.requests.clear();
  }
}
