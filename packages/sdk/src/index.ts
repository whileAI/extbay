type Params = Record<string, unknown>;
type Pending = { resolve(value: unknown): void; reject(error: Error): void };
export interface ExtBayContext { endpointId?: number }

let nonce: string | undefined;
let context: ExtBayContext = {};
const pending = new Map<string, Pending>();
let resolveReady!: (context: ExtBayContext) => void;
const ready = new Promise<ExtBayContext>((resolve) => { resolveReady = resolve; });

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || typeof event.data !== 'object') return;
  if (event.data.type === 'extbay.init' && event.data.version === 1 && typeof event.data.nonce === 'string') {
    nonce = event.data.nonce;
    const endpointId = event.data.context?.endpointId;
    context = Number.isSafeInteger(endpointId) && endpointId > 0 ? { endpointId } : {};
    resolveReady(context);
    return;
  }
  if (event.data.type !== 'extbay.rpc.result' || event.data.nonce !== nonce) return;
  const request = pending.get(event.data.requestId); if (!request) return;
  pending.delete(event.data.requestId);
  if (event.data.ok) request.resolve(event.data.value); else request.reject(new Error(event.data.error ?? 'RPC failed'));
});

function call<T>(method: string, params: Params = {}): Promise<T> {
  if (!nonce) return Promise.reject(new Error('ExtBay SDK has not been initialized'));
  const requestId = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => { pending.delete(requestId); reject(new Error(`RPC timeout: ${method}`)); }, 30_000);
    pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value as T); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    window.parent.postMessage({ type: 'extbay.rpc', nonce, requestId, method, params }, '*');
  });
}

export const extbay = {
  ready: () => ready,
  context: () => context,
  containers: {
    list: (endpointId: number) => call<unknown[]>('containers.list', { endpointId }),
    inspect: (endpointId: number, id: string) => call<unknown>('containers.inspect', { endpointId, id }),
    restart: (endpointId: number, id: string) => call<void>('containers.restart', { endpointId, id }),
  },
  stacks: { list: (endpointId: number) => call<unknown[]>('stacks.list', { endpointId }) },
  volumes: { list: (endpointId: number) => call<unknown>('volumes.list', { endpointId }) },
  metrics: {
    gpu: (endpointId: number) => call<unknown>('metrics.gpu', { endpointId }),
    host: (endpointId: number) => call<unknown>('metrics.host', { endpointId }),
  },
  storage: {
    get: <T>(key: string) => call<T | null>('storage.get', { key }),
    set: (key: string, value: unknown) => call<void>('storage.set', { key, value }),
  },
};

export default extbay;
