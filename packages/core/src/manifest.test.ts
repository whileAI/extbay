import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';

const valid = {
  schemaVersion: 1,
  id: 'whileai.ai-models',
  name: 'AI Models',
  version: '1.0.0',
  author: 'whileAI',
  compatibility: { portainer: '>=2.0.0' },
  runtime: { reload: 'hot' },
  permissions: ['containers.read', 'gpu.metrics'],
  ui: { entry: 'dist/index.html', sidebar: { title: 'AI Models', icon: 'cpu' } },
};

describe('manifest validation', () => {
  it('accepts a complete v1 manifest', async () => {
    await expect(validateManifest(valid)).resolves.toEqual(valid);
  });

  it('rejects unknown permissions and properties', async () => {
    await expect(validateManifest({ ...valid, root: true, permissions: ['docker.sock'] })).rejects.toThrow();
  });

  it.each(['/etc/passwd', '../index.html', 'dist/../../index.html', 'dist\\index.html'])(
    'rejects unsafe UI entry %s',
    async (entry) => expect(validateManifest({ ...valid, ui: { ...valid.ui, entry } })).rejects.toThrow(),
  );

  it('requires digest-pinned backend images', async () => {
    await expect(validateManifest({ ...valid, backend: { image: 'example/backend:latest' } })).rejects.toThrow();
  });
});
