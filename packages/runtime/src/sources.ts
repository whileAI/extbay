import { createWriteStream } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

export interface ResolvedSource { archive: string; canonical: string; signature?: string; checksum?: string }

export async function resolveSource(source: string): Promise<ResolvedSource> {
  if (source.startsWith('github:')) return resolveGithub(source.slice(7));
  if (/^https:\/\//.test(source)) return resolveUrl(source);
  if (/^http:/.test(source)) throw new Error('plain HTTP sources are forbidden');
  const local = path.resolve(source);
  if (!local.endsWith('.extbay')) throw new Error('local package must end with .extbay');
  const info = await stat(local);
  if (!info.isFile() || info.size > config.limits.maxArchiveBytes) throw new Error('invalid or oversized local package');
  const signature = await existing(`${local}.sig`);
  const checksum = await existing(`${local}.sha256`);
  return { archive: local, canonical: `file:${local}`, ...(signature ? { signature } : {}), ...(checksum ? { checksum } : {}) };
}

async function resolveGithub(spec: string): Promise<ResolvedSource> {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:@([^/]+))?$/.exec(spec);
  if (!match) throw new Error('GitHub source must be github:owner/repo[@version]');
  const [, owner, repo, version] = match;
  const endpoint = version
    ? `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(version)}`
    : `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  let response = await fetch(endpoint, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'ExtBay/0.1' } });
  if (!response.ok && version && !version.startsWith('v')) {
    response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/v${encodeURIComponent(version)}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'ExtBay/0.1' } });
  }
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`);
  const release = await response.json() as { assets?: Array<{ name: string; browser_download_url: string }> };
  const assets = release.assets?.filter((asset) => asset.name.endsWith('.extbay')) ?? [];
  if (assets.length !== 1) throw new Error(`release must contain exactly one .extbay asset; found ${assets.length}`);
  const primary = assets[0]!;
  const result = await download(primary.browser_download_url, `github:${owner}/${repo}${version ? `@${version}` : ''}`);
  const signatureAsset = release.assets?.find((asset) => asset.name === `${primary.name}.sig`);
  const checksumAsset = release.assets?.find((asset) => asset.name === `${primary.name}.sha256`);
  const signature = signatureAsset ? await downloadSmall(signatureAsset.browser_download_url, '.sig') : undefined;
  const checksum = checksumAsset ? await downloadSmall(checksumAsset.browser_download_url, '.sha256') : undefined;
  return { ...result, ...(signature ? { signature } : {}), ...(checksum ? { checksum } : {}) };
}

async function resolveUrl(url: string): Promise<ResolvedSource> {
  const result = await download(url, url);
  const signature = await downloadSmall(`${url}.sig`, '.sig', true);
  const checksum = await downloadSmall(`${url}.sha256`, '.sha256', true);
  return { ...result, ...(signature ? { signature } : {}), ...(checksum ? { checksum } : {}) };
}

async function download(url: string, canonical: string): Promise<ResolvedSource> {
  await mkdir(path.join(config.data, 'downloads'), { recursive: true, mode: 0o700 });
  const target = path.join(config.data, 'downloads', `${randomUUID()}.extbay`);
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`);
  if (new URL(response.url).protocol !== 'https:') throw new Error('download redirected to a non-HTTPS URL');
  const advertised = Number(response.headers.get('content-length') ?? 0);
  if (advertised > config.limits.maxArchiveBytes) throw new Error('download exceeds archive limit');
  let received = 0;
  const bounded = Readable.fromWeb(response.body as never).map((chunk: Buffer) => {
    received += chunk.length;
    if (received > config.limits.maxArchiveBytes) throw new Error('download exceeds archive limit');
    return chunk;
  });
  await pipeline(bounded, createWriteStream(target, { mode: 0o600, flags: 'wx' }));
  return { archive: target, canonical };
}

async function downloadSmall(url: string, suffix: string, optional = false): Promise<string | undefined> {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  if (optional && response.status === 404) return undefined;
  if (!response.ok || !response.body) throw new Error(`companion download failed (${response.status})`);
  if (new URL(response.url).protocol !== 'https:') throw new Error('companion redirected to a non-HTTPS URL');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 64 * 1024) throw new Error('signature/checksum companion exceeds 64 KiB');
  const target = path.join(config.data, 'downloads', `${randomUUID()}${suffix}`);
  await import('node:fs/promises').then((fs) => fs.writeFile(target, data, { mode: 0o600, flag: 'wx' }));
  return target;
}

async function existing(file: string): Promise<string | undefined> {
  try { await access(file); return file; } catch { return undefined; }
}
