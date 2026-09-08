import Docker from 'dockerode';
import tar from 'tar-fs';
import type { Manifest } from '@extbay/core';
import { config } from './config.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export class PanelAssetManager {
  async publish(manifest: Manifest, directory: string): Promise<void> {
    if (!config.panelContainer) return;
    const prefix = `extbay-extensions/${manifest.id}/${manifest.version}`;
    const archive = tar.pack(directory, {
      map(header) {
        header.name = `${prefix}/${header.name}`;
        header.uid = 0;
        header.gid = 0;
        if (header.type === 'file') header.mode = 0o644;
        if (header.type === 'directory') header.mode = 0o755;
        return header;
      },
    });
    const container = docker.getContainer(config.panelContainer);
    await new Promise<void>((resolve, reject) => {
      container.putArchive(archive, { path: '/public' }, (error) => error ? reject(error) : resolve());
    });
  }
}
