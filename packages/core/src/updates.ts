import semver from 'semver';
import type { Permission } from './types.js';

export function isNewerVersion(candidate: string, current: string): boolean {
  return Boolean(semver.valid(candidate) && semver.valid(current) && semver.gt(candidate, current));
}

export function addedPermissions(current: Permission[], requested: Permission[]): Permission[] {
  const granted = new Set(current);
  return requested.filter((permission) => !granted.has(permission));
}
