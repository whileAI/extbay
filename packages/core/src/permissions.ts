import type { Permission } from './types.js';

const METHOD_PERMISSION: Readonly<Record<string, Permission>> = {
  'containers.list': 'containers.read',
  'containers.inspect': 'containers.read',
  'containers.restart': 'containers.control',
  'stacks.list': 'stacks.read',
  'stacks.update': 'stacks.write',
  'volumes.list': 'volumes.read',
  'metrics.gpu': 'gpu.metrics',
  'metrics.host': 'host.metrics',
  'network.fetch': 'network.outbound',
  'storage.get': 'extension.storage',
  'storage.set': 'extension.storage',
};

export function permissionForMethod(method: string): Permission | undefined {
  return METHOD_PERMISSION[method];
}

export function requirePermission(granted: readonly Permission[], method: string): Permission {
  const required = permissionForMethod(method);
  if (!required) throw Object.assign(new Error(`RPC method is not allowlisted: ${method}`), { statusCode: 400 });
  if (!granted.includes(required)) throw Object.assign(new Error(`permission denied: ${required}`), { statusCode: 403 });
  return required;
}
