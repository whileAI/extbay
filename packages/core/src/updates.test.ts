import { describe, expect, it } from 'vitest';
import { addedPermissions, isNewerVersion } from './updates.js';

describe('extension updates', () => {
  it('compares semantic versions', () => {
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('not-a-version', '1.0.0')).toBe(false);
  });

  it('returns permissions added by an update', () => {
    expect(addedPermissions(['containers.read'], ['containers.read', 'gpu.metrics'])).toEqual(['gpu.metrics']);
  });
});
