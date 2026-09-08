import type { Permission } from '@extbay/core';
import { ExtensionManager } from './manager.js';

interface BridgeRequest {
  method?: string;
  path?: string;
  body?: { approvedPermissions?: Permission[] };
  userId?: number;
}

const manager = new ExtensionManager();

try {
  const encoded = process.argv[2];
  if (!encoded || encoded.length > 128 * 1024) throw statusError(400, 'invalid bridge request');
  const request = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as BridgeRequest;
  const result = await dispatch(request);
  process.stdout.write(JSON.stringify({ status: 200, body: result }));
} catch (error) {
  const status = Number((error as { statusCode?: number }).statusCode ?? 500);
  process.stdout.write(JSON.stringify({ status: status >= 400 && status < 600 ? status : 500, body: { error: error instanceof Error ? error.message : 'bridge error' } }));
}

async function dispatch(request: BridgeRequest): Promise<unknown> {
  const method = request.method ?? 'GET';
  const path = request.path ?? '';
  if (method === 'GET' && path === '/extbay/api/extensions') return manager.store.read();
  if (method === 'GET' && path === '/extbay/api/updates') return manager.checkUpdates(validUserId(request.userId));

  const toggle = /^\/extbay\/api\/extensions\/([^/]+)\/(enable|disable)$/.exec(path);
  if (method === 'POST' && toggle) return manager.setEnabled(decodeURIComponent(toggle[1]!), toggle[2] === 'enable');

  const update = /^\/extbay\/api\/updates\/([^/]+)\/(install|defer)$/.exec(path);
  if (method === 'POST' && update) {
    const id = decodeURIComponent(update[1]!);
    if (update[2] === 'defer') { await manager.deferUpdate(validUserId(request.userId), id); return { deferredHours: 24 }; }
    const permissions = request.body?.approvedPermissions;
    if (!Array.isArray(permissions)) throw statusError(400, 'approvedPermissions must be an array');
    return manager.updateExtension(id, permissions);
  }
  throw statusError(404, 'unsupported bridge operation');
}

function validUserId(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw statusError(400, 'invalid user id');
  return Number(value);
}

function statusError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}
