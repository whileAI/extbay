import path from 'node:path';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { verify } from 'node:crypto';
import { addedPermissions, extractPackage, isNewerVersion, StateStore, assertCompatible, type ExtensionUpdate, type Manifest, type Permission, type RegistryState } from '@extbay/core';
import { config } from './config.js';
import { resolveSource } from './sources.js';
import { BackendManager } from './backend.js';

const EXTBAY_VERSION = '0.1.0';

export class ExtensionManager {
  readonly store = new StateStore(config.data);
  readonly backends = new BackendManager();

  async portainerVersion(): Promise<string> {
    const response = await fetch(new URL('/api/status', config.portainerUrl));
    if (!response.ok) throw new Error(`Portainer status failed (${response.status})`);
    const status = await response.json() as { Version?: string };
    if (!status.Version) throw new Error('Portainer status did not include Version');
    return status.Version;
  }

  async inspect(source: string): Promise<{ manifest: Manifest; sha256: string; source: string; staged: string; signature: 'verified' | 'unsigned' }> {
    const resolved = await resolveSource(source);
    const staged = path.join(config.data, 'staging', `${process.pid}-${Date.now()}`);
    await mkdir(path.dirname(staged), { recursive: true, mode: 0o700 });
    try {
      const result = await extractPackage(resolved.archive, staged, config.limits);
      await assertCompatible(result.manifest, await this.portainerVersion(), EXTBAY_VERSION);
      if (resolved.checksum) await verifyChecksum(resolved.checksum, result.sha256);
      const signature = resolved.signature ? await verifySignature(resolved.signature, resolved.archive) : 'unsigned';
      return { manifest: result.manifest, sha256: result.sha256, source: resolved.canonical, staged, signature };
    } catch (error) {
      await rm(staged, { recursive: true, force: true });
      throw error;
    } finally {
      if (!resolved.canonical.startsWith('file:')) {
        await Promise.all([resolved.archive, resolved.signature, resolved.checksum].filter((file): file is string => Boolean(file)).map((file) => rm(file, { force: true })));
      }
    }
  }

  async install(source: string, approvedPermissions: Permission[]): Promise<RegistryState> {
    const inspected = await this.inspect(source);
    return this.activate(inspected, approvedPermissions);
  }

  async checkUpdates(userId: number): Promise<ExtensionUpdate[]> {
    const state = await this.store.read();
    const deferred = state.updateDeferrals?.[String(userId)] ?? {};
    const updates: ExtensionUpdate[] = [];
    for (const extension of Object.values(state.extensions)) {
      const installed = extension.versions[extension.activeVersion];
      if (!installed || !isUpdateSource(installed.source)) continue;
      const until = Date.parse(deferred[extension.id] ?? '');
      if (Number.isFinite(until) && until > Date.now()) continue;
      let inspected: Awaited<ReturnType<ExtensionManager['inspect']>> | undefined;
      try {
        inspected = await this.inspect(installed.source);
        if (inspected.manifest.id !== extension.id || !isNewerVersion(inspected.manifest.version, extension.activeVersion)) continue;
        updates.push({
          id: extension.id,
          name: inspected.manifest.name,
          currentVersion: extension.activeVersion,
          availableVersion: inspected.manifest.version,
          source: installed.source,
          permissions: inspected.manifest.permissions,
          newPermissions: addedPermissions(extension.grantedPermissions, inspected.manifest.permissions),
          reload: inspected.manifest.runtime.reload,
          signature: inspected.signature,
        });
      } catch (error) {
        await this.audit('update-check-failed', extension.id, { error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (inspected) await rm(inspected.staged, { recursive: true, force: true });
      }
    }
    return updates;
  }

  async deferUpdate(userId: number, id: string): Promise<void> {
    await this.store.update((state) => {
      if (!state.extensions[id]) throw new Error(`extension not found: ${id}`);
      const key = String(userId);
      state.updateDeferrals ??= {};
      state.updateDeferrals[key] ??= {};
      state.updateDeferrals[key]![id] = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    });
    await this.audit('update-deferred', id, { userId, hours: 24 });
  }

  async updateExtension(id: string, approvedPermissions: Permission[]): Promise<RegistryState> {
    const state = await this.store.read();
    const extension = state.extensions[id];
    const active = extension?.versions[extension.activeVersion];
    if (!extension || !active) throw new Error(`extension not found: ${id}`);
    if (!isUpdateSource(active.source)) throw new Error('this source does not support automatic updates');
    const inspected = await this.inspect(active.source);
    if (inspected.manifest.id !== id) {
      await rm(inspected.staged, { recursive: true, force: true });
      throw new Error('update package has a different extension id');
    }
    if (!isNewerVersion(inspected.manifest.version, extension.activeVersion)) {
      await rm(inspected.staged, { recursive: true, force: true });
      throw new Error('no newer version is available');
    }
    return this.activate(inspected, approvedPermissions);
  }

  private async activate(inspected: Awaited<ReturnType<ExtensionManager['inspect']>>, approvedPermissions: Permission[]): Promise<RegistryState> {
    const requested = new Set(inspected.manifest.permissions);
    if (approvedPermissions.some((p) => !requested.has(p)) || approvedPermissions.length !== requested.size) {
      await rm(inspected.staged, { recursive: true, force: true });
      throw new Error('approved permissions must exactly match requested permissions');
    }
    const destination = path.join(config.data, 'extensions', inspected.manifest.id, inspected.manifest.version);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const before = await this.store.read();
    const existingVersion = before.extensions[inspected.manifest.id]?.versions[inspected.manifest.version];
    if (existingVersion && existingVersion.sha256 !== inspected.sha256) {
      await rm(inspected.staged, { recursive: true, force: true });
      throw new Error(`immutable version conflict: ${inspected.manifest.id}@${inspected.manifest.version}`);
    }
    if (existingVersion) await rm(inspected.staged, { recursive: true, force: true });
    else await import('node:fs/promises').then((fs) => fs.rename(inspected.staged, destination));
    try {
      await this.backends.start(inspected.manifest);
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
    const result = await this.store.update((state) => {
      const current = state.extensions[inspected.manifest.id];
      state.extensions[inspected.manifest.id] = {
        id: inspected.manifest.id,
        enabled: current?.enabled ?? true,
        activeVersion: inspected.manifest.version,
        grantedPermissions: approvedPermissions,
        versions: {
          ...(current?.versions ?? {}),
          [inspected.manifest.version]: {
            version: inspected.manifest.version,
            sha256: inspected.sha256,
            installedAt: new Date().toISOString(),
            source: inspected.source,
            manifest: inspected.manifest,
            signature: inspected.signature,
          },
        },
        pendingRestart: inspected.manifest.runtime.reload === 'portainer-restart',
      };
      for (const deferrals of Object.values(state.updateDeferrals ?? {})) delete deferrals[inspected.manifest.id];
    });
    await this.backends.stopOtherVersions(inspected.manifest.id, inspected.manifest.backend ? inspected.manifest.version : undefined);
    await this.audit('install', inspected.manifest.id, { version: inspected.manifest.version, sha256: inspected.sha256, signature: inspected.signature });
    return result;
  }

  async setEnabled(id: string, enabled: boolean) {
    const before = await this.store.read();
    const current = before.extensions[id];
    if (!current) throw new Error(`extension not found: ${id}`);
    const active = current.versions[current.activeVersion]!;
    if (enabled) await this.backends.start(active.manifest);
    const result = await this.store.update((state) => {
      const extension = state.extensions[id];
      if (!extension) throw new Error(`extension not found: ${id}`);
      extension.enabled = enabled;
    });
    if (!enabled) await this.backends.stopOtherVersions(id);
    await this.audit(enabled ? 'enable' : 'disable', id);
    return result;
  }

  async rollback(id: string, version: string) {
    const before = await this.store.read();
    const selected = before.extensions[id]?.versions[version];
    if (!selected) throw new Error(`verified version not found: ${id}@${version}`);
    if (before.extensions[id]!.enabled) await this.backends.start(selected.manifest);
    const result = await this.store.update((state) => {
      const extension = state.extensions[id];
      if (!extension?.versions[version]) throw new Error(`verified version not found: ${id}@${version}`);
      extension.activeVersion = version;
      extension.pendingRestart = extension.versions[version]!.manifest.runtime.reload === 'portainer-restart';
    });
    await this.backends.stopOtherVersions(id, selected.manifest.backend ? version : undefined);
    await this.audit('rollback', id, { version });
    return result;
  }

  async uninstall(id: string) {
    const state = await this.store.update((draft) => {
      if (!draft.extensions[id]) throw new Error(`extension not found: ${id}`);
      delete draft.extensions[id];
    });
    await rm(path.join(config.data, 'extensions', id), { recursive: true, force: true });
    await this.backends.stopOtherVersions(id);
    await this.audit('uninstall', id);
    return state;
  }

  async storage(id: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(path.join(config.data, 'storage', `${id}.json`), 'utf8').catch(() => '{}')) as Record<string, unknown>;
  }

  async logs(id?: string): Promise<string> {
    const audit = await readFile(path.join(config.data, 'logs', id ? `${id}.log` : 'runtime.log'), 'utf8').catch(() => '');
    const backend = id ? await this.backends.logs(id) : '';
    return [audit.trim(), backend.trim()].filter(Boolean).join('\n') || `No logs found for ${id ?? 'runtime'}.`;
  }

  private async audit(action: string, id: string, details: Record<string, unknown> = {}) {
    const line = `${JSON.stringify({ time: new Date().toISOString(), action, extension: id, ...details })}\n`;
    const directory = path.join(config.data, 'logs');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await Promise.all([appendFile(path.join(directory, 'runtime.log'), line, { mode: 0o600 }), appendFile(path.join(directory, `${id}.log`), line, { mode: 0o600 })]);
  }
}

function isUpdateSource(source: string): boolean {
  if (source.startsWith('https://')) return true;
  return /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source);
}

async function verifyChecksum(file: string, actual: string) {
  const text = await readFile(file, 'utf8');
  const expected = /^([a-fA-F0-9]{64})(?:\s|$)/.exec(text.trim())?.[1]?.toLowerCase();
  if (!expected || expected !== actual) throw new Error('SHA-256 checksum mismatch');
}

async function verifySignature(file: string, archive: string): Promise<'verified'> {
  const document = JSON.parse(await readFile(file, 'utf8')) as { algorithm?: string; keyId?: string; signature?: string };
  if (document.algorithm !== 'ed25519' || typeof document.keyId !== 'string' || typeof document.signature !== 'string') throw new Error('invalid detached signature document');
  const keys = JSON.parse(await readFile(path.join(config.data, 'trust', 'keys.json'), 'utf8').catch(() => '{}')) as Record<string, string>;
  const publicKey = keys[document.keyId];
  if (!publicKey) throw new Error(`signature key is not trusted: ${document.keyId}`);
  const valid = verify(null, await readFile(archive), publicKey, Buffer.from(document.signature, 'base64'));
  if (!valid) throw new Error('invalid package signature');
  return 'verified';
}
