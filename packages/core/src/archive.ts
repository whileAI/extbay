import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import { validateManifest } from './manifest.js';
import type { Manifest } from './types.js';

export interface ArchiveLimits {
  maxArchiveBytes: number;
  maxFiles: number;
  maxUnpackedBytes: number;
}

export const DEFAULT_LIMITS: ArchiveLimits = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxFiles: 2048,
  maxUnpackedBytes: 200 * 1024 * 1024,
};

export interface ExtractedPackage { manifest: Manifest; sha256: string; directory: string }

function safeRelative(name: string): string {
  if (name.includes('\\') || name.includes('\0') || path.posix.isAbsolute(name)) throw new Error(`unsafe archive path: ${name}`);
  const normalized = path.posix.normalize(name);
  if (normalized === '..' || normalized.startsWith('../')) throw new Error(`archive path escapes root: ${name}`);
  return normalized.replace(/\/$/, '');
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function extractPackage(archive: string, destination: string, limits = DEFAULT_LIMITS): Promise<ExtractedPackage> {
  const handle = await open(archive, 'r');
  const stat = await handle.stat();
  await handle.close();
  if (stat.size > limits.maxArchiveBytes) throw new Error(`archive exceeds ${limits.maxArchiveBytes} bytes`);

  const staging = `${destination}.staging-${process.pid}-${Date.now()}`;
  await mkdir(staging, { recursive: false, mode: 0o700 });
  try {
    await extractZip(archive, staging, limits);
    const raw = await readFile(path.join(staging, 'extbay.json'), 'utf8').catch(() => { throw new Error('extbay.json is required at archive root'); });
    const manifest = await validateManifest(JSON.parse(raw) as unknown);
    const entry = path.join(staging, ...manifest.ui.entry.split('/'));
    const entryStat = await open(entry, 'r').then(async (f) => { const s = await f.stat(); await f.close(); return s; }).catch(() => undefined);
    if (!entryStat?.isFile()) throw new Error(`UI entry does not exist: ${manifest.ui.entry}`);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await rename(staging, destination);
    return { manifest, sha256: await sha256(archive), directory: destination };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function extractZip(archive: string, destination: string, limits: ArchiveLimits): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError ?? new Error('cannot open archive'));
      let files = 0;
      let unpacked = 0;
      let failed = false;
      const fail = (error: unknown) => { if (!failed) { failed = true; zip.close(); reject(error); } };
      zip.on('error', fail);
      zip.on('end', () => { if (!failed) resolve(); });
      zip.on('entry', (entry) => {
        void (async () => {
          files += 1;
          unpacked += entry.uncompressedSize;
          if (files > limits.maxFiles) throw new Error(`archive contains more than ${limits.maxFiles} entries`);
          if (unpacked > limits.maxUnpackedBytes) throw new Error(`unpacked archive exceeds ${limits.maxUnpackedBytes} bytes`);
          const relative = safeRelative(entry.fileName);
          if (!relative) return zip.readEntry();
          const target = path.join(destination, ...relative.split('/'));
          if ((entry.externalFileAttributes >>> 28) === 0xa) throw new Error(`symlinks are forbidden: ${relative}`);
          if (/\/$/.test(entry.fileName)) { await mkdir(target, { recursive: true, mode: 0o700 }); return zip.readEntry(); }
          await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          zip.openReadStream(entry, async (streamError, stream) => {
            if (streamError || !stream) return fail(streamError ?? new Error('cannot read zip entry'));
            try {
              const out = await open(target, 'wx', 0o600);
              try { for await (const chunk of stream) await out.write(chunk as Buffer); }
              finally { await out.close(); }
              zip.readEntry();
            } catch (error) { fail(error); }
          });
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
}
