import Docker from 'dockerode';
import type { Manifest } from '@extbay/core';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const internalNetwork = 'extbay-internal';
const outboundNetwork = 'extbay-outbound';

export class BackendManager {
  async start(manifest: Manifest): Promise<string | undefined> {
    if (!manifest.backend) return undefined;
    const network = manifest.permissions.includes('network.outbound') ? outboundNetwork : internalNetwork;
    await ensureNetwork(network, network === internalNetwork);
    await ensureImage(manifest.backend.image);
    const name = containerName(manifest.id, manifest.version);
    await removeIfExists(name);
    const memory = parseMemory(manifest.backend.memory ?? '256MiB');
    const container = await docker.createContainer({
      name,
      Image: manifest.backend.image,
      Cmd: manifest.backend.command,
      User: '65532:65532',
      WorkingDir: '/data',
      Labels: { 'io.extbay.extension': manifest.id, 'io.extbay.version': manifest.version, 'io.extbay.managed': 'true' },
      HostConfig: {
        AutoRemove: false,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        NetworkMode: network,
        Memory: memory,
        NanoCpus: Math.floor((manifest.backend.cpus ?? 0.5) * 1e9),
        PidsLimit: 128,
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=64m,mode=1777' },
        Mounts: [{ Type: 'volume', Source: volumeName(manifest.id), Target: '/data', ReadOnly: false }],
      },
    });
    try {
      await container.start();
      await waitHealthy(container);
      return name;
    } catch (error) {
      await container.remove({ force: true }).catch(() => undefined);
      throw error;
    }
  }

  async stopOtherVersions(id: string, activeVersion?: string): Promise<void> {
    const containers = await docker.listContainers({ all: true, filters: { label: [`io.extbay.extension=${id}`, 'io.extbay.managed=true'] } });
    for (const info of containers) {
      if (activeVersion && info.Labels['io.extbay.version'] === activeVersion) continue;
      const container = docker.getContainer(info.Id);
      await container.stop({ t: 10 }).catch(() => undefined);
      await container.remove({ force: true }).catch(() => undefined);
    }
  }

  async logs(id: string): Promise<string> {
    const containers = await docker.listContainers({ all: true, filters: { label: [`io.extbay.extension=${id}`, 'io.extbay.managed=true'] } });
    const output: string[] = [];
    for (const info of containers) {
      const raw = await docker.getContainer(info.Id).logs({ stdout: true, stderr: true, timestamps: true, tail: 200 });
      output.push(`== ${info.Names[0] ?? info.Id.slice(0, 12)} ==\n${decodeDockerLog(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw)))}`);
    }
    return output.join('\n');
  }

  async health(): Promise<Array<{ id: string; version: string; status: string }>> {
    const containers = await docker.listContainers({ all: true, filters: { label: ['io.extbay.managed=true'] } });
    return containers.map((item) => ({ id: item.Labels['io.extbay.extension'] ?? 'unknown', version: item.Labels['io.extbay.version'] ?? 'unknown', status: item.Status }));
  }
}

async function ensureNetwork(name: string, internal: boolean) {
  try { await docker.getNetwork(name).inspect(); }
  catch { await docker.createNetwork({ Name: name, Driver: 'bridge', Internal: internal, CheckDuplicate: true }); }
}
async function ensureImage(image: string) {
  try { await docker.getImage(image).inspect(); return; } catch { /* pull the immutable digest below */ }
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => docker.modem.followProgress(stream, (error) => error ? reject(error) : resolve()));
  const info = await docker.getImage(image).inspect();
  const digest = image.slice(image.lastIndexOf('@'));
  if (!info.RepoDigests?.some((repoDigest) => repoDigest.endsWith(digest))) throw new Error(`Docker did not resolve the requested image digest: ${image}`);
}
async function removeIfExists(name: string) { try { await docker.getContainer(name).remove({ force: true }); } catch (error) { if ((error as { statusCode?: number }).statusCode !== 404) throw error; } }
async function waitHealthy(container: Docker.Container) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const info = await container.inspect();
    const health = info.State.Health?.Status;
    if (info.State.Running && (!health || health === 'healthy')) return;
    if (!info.State.Running || health === 'unhealthy') throw new Error(`backend failed health check: ${info.State.Error || health || 'stopped'}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('backend health check timed out');
}
function containerName(id: string, version: string) { return `extbay-${id.replaceAll('.', '-')}-${version.replace(/[^A-Za-z0-9_.-]/g, '-')}`.slice(0, 128); }
function volumeName(id: string) { return `extbay-storage-${id.replaceAll('.', '-')}`.slice(0, 128); }
function parseMemory(value: string) {
  const match = /^([1-9][0-9]*)(KiB|MiB|GiB|KB|MB|GB)$/.exec(value);
  if (!match) throw new Error(`invalid backend memory: ${value}`);
  const units: Record<string, number> = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3 };
  return Number(match[1]) * units[match[2]!]!;
}

function decodeDockerLog(data: Buffer): string {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= data.length && (data[offset] === 1 || data[offset] === 2)) {
    const length = data.readUInt32BE(offset + 4);
    if (offset + 8 + length > data.length) return data.toString('utf8');
    chunks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  return (chunks.length && offset === data.length ? Buffer.concat(chunks) : data).toString('utf8');
}
