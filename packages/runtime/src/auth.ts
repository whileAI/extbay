import type { IncomingMessage } from 'node:http';
import { config } from './config.js';

export interface PortainerUser { Id: number; Username: string; Role: number }
export interface PortainerSession { user: PortainerUser; headers: Headers }

export async function authenticate(request: IncomingMessage, admin = false): Promise<PortainerUser> {
  return (await authenticateSession(request, admin)).user;
}

export async function authenticateSession(request: IncomingMessage, admin = false): Promise<PortainerSession> {
  const headers: Record<string, string> = {};
  for (const name of ['cookie', 'authorization', 'x-csrf-token']) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  const response = await fetch(new URL('/api/users/me', config.portainerUrl), { headers, redirect: 'manual' });
  if (!response.ok) throw Object.assign(new Error('Portainer authentication required'), { statusCode: 401 });
  const user = await response.json() as PortainerUser;
  if (admin && user.Role !== 1) throw Object.assign(new Error('Portainer administrator required'), { statusCode: 403 });
  const forwarded = portainerHeaders(request);
  const csrf = response.headers.get('x-csrf-token');
  if (csrf) forwarded.set('x-csrf-token', csrf);
  return { user, headers: forwarded };
}

export function portainerHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const name of ['cookie', 'authorization', 'x-csrf-token']) {
    const value = request.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  return headers;
}
