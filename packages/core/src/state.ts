import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RegistryState } from './types.js';

const EMPTY: RegistryState = { revision: 0, extensions: {} };

export class StateStore {
  private readonly file: string;
  private readonly lock: string;

  constructor(private readonly dataDirectory: string) {
    this.file = path.join(dataDirectory, 'state.json');
    this.lock = path.join(dataDirectory, 'state.lock');
  }

  async read(): Promise<RegistryState> {
    const raw = await readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!raw) return structuredClone(EMPTY);
    const state = JSON.parse(raw) as RegistryState;
    if (!Number.isSafeInteger(state.revision) || typeof state.extensions !== 'object') throw new Error('corrupt ExtBay state');
    return state;
  }

  async update(mutator: (state: RegistryState) => void): Promise<RegistryState> {
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
    const lock = await this.acquire();
    try {
      const state = await this.read();
      mutator(state);
      state.revision += 1;
      const temporary = `${this.file}.tmp-${process.pid}`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.file);
      return structuredClone(state);
    } finally {
      await lock.close();
      await rm(this.lock, { force: true });
    }
  }

  private async acquire() {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        return await open(this.lock, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
}
