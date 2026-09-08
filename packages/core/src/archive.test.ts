import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { extractPackage } from './archive.js';

const manifest = {
  schemaVersion: 1, id: 'test.safe', name: 'Safe', version: '1.0.0', author: 'test',
  compatibility: { portainer: '>=2.0.0' }, runtime: { reload: 'hot' }, permissions: [],
  ui: { entry: 'dist/index.html', sidebar: { title: 'Safe', icon: 'box' } },
};

describe('package extraction', () => {
  it('extracts a valid package', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'extbay-test-'));
    const archive = path.join(root, 'safe.extbay');
    await zip(archive, [['extbay.json', JSON.stringify(manifest)], ['dist/index.html', '<h1>safe</h1>']]);
    const result = await extractPackage(archive, path.join(root, 'out'));
    expect(result.manifest.id).toBe('test.safe');
    expect(await readFile(path.join(root, 'out/dist/index.html'), 'utf8')).toBe('<h1>safe</h1>');
  });

  it('enforces the file-count limit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'extbay-test-'));
    const archive = path.join(root, 'many.extbay');
    await zip(archive, [['extbay.json', JSON.stringify(manifest)], ['dist/index.html', 'x']]);
    await expect(extractPackage(archive, path.join(root, 'out'), { maxArchiveBytes: 100_000, maxFiles: 1, maxUnpackedBytes: 100_000 })).rejects.toThrow('more than 1');
  });

  it('rejects parent traversal paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'extbay-test-'));
    const archive = path.join(root, 'traversal.extbay');
    await zip(archive, [['aa/evil.txt', 'owned']]);
    const bytes = await readFile(archive);
    const original = Buffer.from('aa/evil.txt');
    const replacement = Buffer.from('../evil.txt');
    let replacements = 0;
    for (let offset = bytes.indexOf(original); offset >= 0; offset = bytes.indexOf(original, offset + replacement.length)) {
      replacement.copy(bytes, offset); replacements += 1;
    }
    expect(replacements).toBeGreaterThan(0);
    await writeFile(archive, bytes);
    await expect(extractPackage(archive, path.join(root, 'out'))).rejects.toThrow(/invalid relative path|escapes root/);
  });
});

async function zip(file: string, entries: Array<[string, string]>) {
  const output = new yazl.ZipFile();
  for (const [name, value] of entries) output.addBuffer(Buffer.from(value), name);
  output.end();
  output.outputStream.pipe(createWriteStream(file));
  await finished(output.outputStream);
}
