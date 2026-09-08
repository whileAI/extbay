import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { requirePermission } from '@extbay/core';
import { authenticateSession } from './auth.js';
import { config } from './config.js';
import type { ExtensionManager } from './manager.js';

interface RPCRequest { extensionId: string; method: string; params?: Record<string, unknown> }

const idPattern = /^[a-z0-9][a-z0-9.-]{1,127}$/;
const objectIdPattern = /^[A-Za-z0-9_.:@+-]{1,128}$/;

export async function executeRPC(request: IncomingMessage, body: RPCRequest, manager: ExtensionManager): Promise<unknown> {
  const session = await authenticateSession(request);
  const user = session.user;
  if (!idPattern.test(body.extensionId)) throw badRequest('invalid extension id');
  const state = await manager.store.read();
  const extension = state.extensions[body.extensionId];
  if (!extension?.enabled) throw Object.assign(new Error('extension is not enabled'), { statusCode: 403 });
  requirePermission(extension.grantedPermissions, body.method);
  const params = body.params ?? {};

  if (body.method === 'storage.get') return storageGet(body.extensionId, user.Id, stringParam(params, 'key', 128));
  if (body.method === 'storage.set') return storageSet(body.extensionId, user.Id, stringParam(params, 'key', 128), params.value);

  const endpointId = integerParam(params, 'endpointId');
  let method = 'GET';
  let apiPath: string;
  switch (body.method) {
    case 'containers.list': apiPath = `/api/endpoints/${endpointId}/docker/containers/json?all=1`; break;
    case 'containers.inspect': apiPath = `/api/endpoints/${endpointId}/docker/containers/${objectId(params, 'id')}/json`; break;
    case 'containers.restart': method = 'POST'; apiPath = `/api/endpoints/${endpointId}/docker/containers/${objectId(params, 'id')}/restart`; break;
    case 'volumes.list': apiPath = `/api/endpoints/${endpointId}/docker/volumes`; break;
    case 'stacks.list': apiPath = `/api/stacks?filters=${encodeURIComponent(JSON.stringify({ EndpointID: endpointId }))}`; break;
    case 'metrics.host': apiPath = `/api/endpoints/${endpointId}/docker/info`; break;
    case 'metrics.gpu': throw Object.assign(new Error('GPU metrics provider is not configured'), { statusCode: 501 });
    case 'stacks.update': throw Object.assign(new Error('stacks.update requires the typed deployment API, not yet implemented'), { statusCode: 501 });
    default: throw badRequest('unsupported RPC method');
  }
  const response = await fetch(new URL(apiPath, config.portainerUrl), { method, headers: session.headers, redirect: 'manual' });
  if (!response.ok) throw Object.assign(new Error(`Portainer API rejected request (${response.status})`), { statusCode: response.status });
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('json') ? response.json() : response.text();
}

function badRequest(message: string) { return Object.assign(new Error(message), { statusCode: 400 }); }
function stringParam(params: Record<string, unknown>, name: string, max: number): string {
  const value = params[name];
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw badRequest(`invalid ${name}`);
  return value;
}
function integerParam(params: Record<string, unknown>, name: string): number {
  const value = params[name];
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw badRequest(`invalid ${name}`);
  return value as number;
}
function objectId(params: Record<string, unknown>, name: string): string {
  const value = stringParam(params, name, 128);
  if (!objectIdPattern.test(value)) throw badRequest(`invalid ${name}`);
  return encodeURIComponent(value);
}

export async function storageGet(extension: string, userId: number, key: string) {
  const values = await readStorage(extension, userId);
  return values[key] ?? null;
}

export async function storageSet(extension: string, userId: number, key: string, value: unknown) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) > 64 * 1024) throw badRequest('storage value exceeds 64 KiB or is not JSON');
  const values = await readStorage(extension, userId);
  values[key] = value;
  const directory = path.join(config.data, 'storage', extension);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${userId}.json`);
  const temporary = `${file}.tmp-${process.pid}`;
  const document = JSON.stringify(values);
  if (Buffer.byteLength(document) > 1024 * 1024) throw badRequest('extension storage quota exceeds 1 MiB');
  await writeFile(temporary, document, { mode: 0o600 });
  await rename(temporary, file);
  return null;
}

async function readStorage(extension: string, userId: number): Promise<Record<string, unknown>> {
  const file = path.join(config.data, 'storage', extension, `${userId}.json`);
  return JSON.parse(await readFile(file, 'utf8').catch(() => '{}')) as Record<string, unknown>;
}
