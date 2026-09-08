#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ExtensionManager } from '@extbay/runtime/manager';

const manager = new ExtensionManager();
const [command, ...args] = process.argv.slice(2);
const yes = args.includes('--yes');
const positional = args.filter((arg) => arg !== '--yes');

try {
  switch (command) {
    case 'install': await install(required(positional[0], 'source')); break;
    case 'update': await update(required(positional[0], 'extension')); break;
    case 'list': await list(); break;
    case 'enable': await manager.setEnabled(required(positional[0], 'extension'), true); console.log('Enabled.'); break;
    case 'disable': await manager.setEnabled(required(positional[0], 'extension'), false); console.log('Disabled.'); break;
    case 'rollback': await manager.rollback(required(positional[0], 'extension'), required(positional[1], 'version')); console.log('Rolled back.'); break;
    case 'uninstall': await uninstall(required(positional[0], 'extension')); break;
    case 'doctor': await doctor(); break;
    case 'logs': await logs(positional[0]); break;
    case 'help': case '--help': case '-h': case undefined: usage(); break;
    default: throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(`extbay: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function install(source: string) {
  const inspected = await manager.inspect(source);
  try {
    const state = await manager.store.read();
    const existing = state.extensions[inspected.manifest.id];
    const added = inspected.manifest.permissions.filter((permission) => !existing?.grantedPermissions.includes(permission));
    if (added.length || !existing) {
      console.log(`\n${inspected.manifest.name} requests:\n`);
      for (const permission of added.length ? added : inspected.manifest.permissions) console.log(`  ${permission}`);
      if (!await confirm('\nInstall? [y/N] ')) throw new Error('installation cancelled');
    }
    if (inspected.signature === 'unsigned') console.warn('Warning: package is unsigned.');
  } finally {
    await import('node:fs/promises').then((fs) => fs.rm(inspected.staged, { recursive: true, force: true }));
  }
  // Inspect again inside install so no mutable staged input crosses the approval boundary.
  const result = await manager.install(source, inspected.manifest.permissions);
  const installed = result.extensions[inspected.manifest.id]!;
  console.log(`Installed ${installed.id}@${installed.activeVersion} (${installed.versions[installed.activeVersion]!.sha256}).`);
  if (installed.pendingRestart) console.log('Portainer restart is pending. ExtBay did not restart Portainer.');
}

async function update(id: string) {
  const state = await manager.store.read();
  const extension = state.extensions[id];
  if (!extension) throw new Error(`extension not found: ${id}`);
  const current = extension.versions[extension.activeVersion]!;
  if (current.source.startsWith('file:')) throw new Error('local extensions must be updated by installing a new .extbay file');
  await install(current.source.startsWith('github:') ? current.source.replace(/@[^@/]+$/, '') : current.source);
}

async function list() {
  const state = await manager.store.read();
  const extensions = Object.values(state.extensions);
  if (!extensions.length) return console.log('No extensions installed.');
  for (const extension of extensions) console.log(`${extension.id}\t${extension.activeVersion}\t${extension.enabled ? 'enabled' : 'disabled'}${extension.pendingRestart ? '\trestart-pending' : ''}`);
}

async function uninstall(id: string) {
  if (!await confirm(`Uninstall ${id}? [y/N] `)) throw new Error('uninstall cancelled');
  await manager.uninstall(id); console.log(`Uninstalled ${id}.`);
}

async function doctor() {
  const checks: Array<[string, () => Promise<unknown>]> = [
    ['Portainer API', () => manager.portainerVersion()],
    ['State', () => manager.store.read()],
    ['Docker socket', () => import('node:fs/promises').then((fs) => fs.access('/var/run/docker.sock'))],
    ['Extension backends', () => manager.backends.health()],
  ];
  let failed = false;
  for (const [name, check] of checks) { try { const result = await check(); console.log(`OK   ${name}${typeof result === 'string' ? `: ${result}` : ''}`); } catch (error) { failed = true; console.log(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); } }
  if (failed) process.exitCode = 1;
}

async function logs(id?: string) {
  console.log(await manager.logs(id));
}

async function confirm(question: string) {
  if (yes) return true;
  if (!stdin.isTTY) return false;
  const readline = createInterface({ input: stdin, output: stdout });
  const answer = await readline.question(question); readline.close();
  return /^(y|yes)$/i.test(answer.trim());
}
function required(value: string | undefined, name: string): string { if (!value) throw new Error(`${name} is required`); return value; }
function usage() { console.log(`ExtBay CLI\n\n  extbay install <github:owner/repo[@version]|https://…|file.extbay> [--yes]\n  extbay list\n  extbay update <extension> [--yes]\n  extbay enable|disable <extension>\n  extbay rollback <extension> <version>\n  extbay uninstall <extension> [--yes]\n  extbay logs [extension]\n  extbay doctor`); }
