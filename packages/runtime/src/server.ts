import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import httpProxy from 'http-proxy';
import { authenticate } from './auth.js';
import { config } from './config.js';
import { ExtensionManager } from './manager.js';
import { executeRPC } from './rpc.js';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
const manager = new ExtensionManager();
const proxy = httpProxy.createProxyServer({ target: config.portainerUrl.origin, ws: true, changeOrigin: false, xfwd: true, selfHandleResponse: true });
proxy.on('proxyReq', (proxyRequest) => proxyRequest.setHeader('accept-encoding', 'identity'));
proxy.on('proxyRes', handleProxyResponse);

export function startServer() {
  const server = createServer((request, response) => void route(request, response));
  server.on('upgrade', (request, socket, head) => proxy.ws(request, socket, head));
  const [host, portText] = splitListen(config.listen);
  server.listen(Number(portText), host, () => console.log(JSON.stringify({ level: 'info', message: 'ExtBay listening', listen: config.listen })));
  return server;
}

async function route(request: IncomingMessage, response: ServerResponse) {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (request.method && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && url.pathname.startsWith('/extbay/')) enforceSameOrigin(request);
    if (url.pathname === '/extbay/bootstrap.js') return serveFile(response, path.join(assets, 'bootstrap.js'), 'text/javascript; charset=utf-8', true);
    if (url.pathname === '/extbay/ui') { await authenticate(request); response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"); return serveFile(response, path.join(assets, 'index.html'), 'text/html; charset=utf-8', true); }
    if (url.pathname === '/extbay/ui.js') { await authenticate(request); return serveFile(response, path.join(assets, 'ui.js'), 'text/javascript; charset=utf-8', true); }
    if (url.pathname === '/extbay/api/health') return json(response, 200, { status: 'ok', portainer: await manager.portainerVersion() });
    if (url.pathname === '/extbay/api/extensions' && request.method === 'GET') { await authenticate(request); return json(response, 200, await manager.store.read()); }
    if (url.pathname === '/extbay/api/rpc' && request.method === 'POST') return json(response, 200, await executeRPC(request, await readJson(request), manager));
    const toggle = /^\/extbay\/api\/extensions\/([^/]+)\/(enable|disable)$/.exec(url.pathname);
    if (toggle && request.method === 'POST') { await authenticate(request, true); return json(response, 200, await manager.setEnabled(decodeURIComponent(toggle[1]!), toggle[2] === 'enable')); }
    if (url.pathname.startsWith('/extbay/extensions/')) return serveExtension(url.pathname, response);
    return proxyPortainer(request, response);
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode ?? 500);
    json(response, status >= 400 && status < 600 ? status : 500, { error: error instanceof Error ? error.message : 'internal error' });
  }
}

async function serveExtension(urlPath: string, response: ServerResponse) {
  const parts = urlPath.split('/').slice(3).map(decodeURIComponent);
  if (parts.length < 3 || parts.some((part) => !part || part === '..' || part.includes('/') || part.includes('\\'))) throw Object.assign(new Error('invalid extension path'), { statusCode: 400 });
  const [id, version, ...relative] = parts;
  const state = await manager.store.read();
  const extension = state.extensions[id!];
  if (!extension?.enabled || extension.activeVersion !== version || !extension.versions[version!]) throw Object.assign(new Error('extension not active'), { statusCode: 404 });
  const file = path.join(config.data, 'extensions', id!, version!, ...relative);
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) throw Object.assign(new Error('asset not found'), { statusCode: 404 });
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return serveFile(response, file, contentType(file), false);
}

function proxyPortainer(request: IncomingMessage, response: ServerResponse) {
  proxy.web(request, response, {}, (error) => { if (!response.headersSent) json(response, 502, { error: `Portainer unavailable: ${error.message}` }); else response.destroy(error); });
}

function handleProxyResponse(upstream: IncomingMessage, _request: IncomingMessage, response: ServerResponse) {
  response.statusCode = upstream.statusCode ?? 502;
  for (const [name, value] of Object.entries(upstream.headers)) if (value !== undefined && !['content-length', 'content-encoding'].includes(name)) response.setHeader(name, value);
  const type = String(upstream.headers['content-type'] ?? '');
  if (!type.includes('text/html')) { upstream.pipe(response); return; }
  const csp = response.getHeader('content-security-policy');
  if (typeof csp === 'string') response.setHeader('content-security-policy', allowSelfFrames(csp));
  const chunks: Buffer[] = [];
  let size = 0;
  upstream.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= 5 * 1024 * 1024) chunks.push(chunk); });
  upstream.on('end', () => {
    if (size > 5 * 1024 * 1024) { response.statusCode = 502; return response.end('Portainer HTML exceeds injection limit'); }
    const html = Buffer.concat(chunks).toString('utf8');
    const tag = '<script src="/extbay/bootstrap.js" defer></script>';
    response.end(html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : `${html}${tag}`);
  });
}

async function readJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += (chunk as Buffer).length; if (size > 64 * 1024) throw Object.assign(new Error('request too large'), { statusCode: 413 }); chunks.push(chunk as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('invalid JSON'), { statusCode: 400 }); }
}

async function serveFile(response: ServerResponse, file: string, type: string, noStore: boolean) {
  response.statusCode = 200; response.setHeader('Content-Type', type); response.setHeader('Cache-Control', noStore ? 'no-store' : 'public, max-age=31536000, immutable'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
  createReadStream(file).on('error', () => json(response, 404, { error: 'not found' })).pipe(response);
}
function json(response: ServerResponse, status: number, body: unknown) { if (response.writableEnded) return; response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(body)); }
function contentType(file: string) { return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' } as Record<string, string>)[path.extname(file)] ?? 'application/octet-stream'; }
function splitListen(value: string) { const index = value.lastIndexOf(':'); if (index < 1) throw new Error('EXTBAY_LISTEN must be host:port'); return [value.slice(0, index), value.slice(index + 1)] as const; }
function enforceSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  const fetchSite = request.headers['sec-fetch-site'];
  let originHost = '';
  try { originHost = typeof origin === 'string' ? new URL(origin).host : ''; } catch { originHost = ''; }
  if (!originHost || originHost !== request.headers.host || (fetchSite && fetchSite !== 'same-origin')) {
    throw Object.assign(new Error('cross-origin request rejected'), { statusCode: 403 });
  }
}
function allowSelfFrames(csp: string): string {
  if (/frame-src\s/i.test(csp)) return csp.replace(/frame-src\s+([^;]*)/i, (directive) => directive.includes("'self'") ? directive : `${directive} 'self'`);
  return `${csp}; frame-src 'self'`;
}
