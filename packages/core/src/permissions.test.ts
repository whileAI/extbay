import { describe, expect, it } from 'vitest';
import { requirePermission } from './permissions.js';

describe('permission mapping', () => {
  it('allows an explicitly granted method', () => expect(requirePermission(['containers.read'], 'containers.list')).toBe('containers.read'));
  it('denies a missing grant', () => expect(() => requirePermission([], 'containers.restart')).toThrow('permission denied'));
  it('denies methods absent from the allowlist', () => expect(() => requirePermission(['containers.control'], 'docker.raw')).toThrow('not allowlisted'));
});
