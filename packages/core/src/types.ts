export const PERMISSIONS = [
  'containers.read', 'containers.control', 'stacks.read', 'stacks.write',
  'volumes.read', 'gpu.metrics', 'host.metrics', 'network.outbound',
  'extension.storage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type ReloadMode = 'hot' | 'ui-reload' | 'portainer-restart';

export interface Manifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  homepage?: string;
  compatibility: { portainer: string; extbay?: string };
  runtime: { reload: ReloadMode };
  permissions: Permission[];
  ui: { entry: string; sidebar: { title: string; icon: string } };
  backend?: {
    image: string;
    command?: string[];
    memory?: string;
    cpus?: number;
    healthPath?: string;
  };
}

export interface InstalledVersion {
  version: string;
  sha256: string;
  installedAt: string;
  source: string;
  manifest: Manifest;
  signature: 'verified' | 'unsigned';
}

export interface InstalledExtension {
  id: string;
  enabled: boolean;
  activeVersion: string;
  grantedPermissions: Permission[];
  versions: Record<string, InstalledVersion>;
  pendingRestart: boolean;
}

export interface RegistryState {
  revision: number;
  extensions: Record<string, InstalledExtension>;
  updateDeferrals?: Record<string, Record<string, string>>;
}

export interface ExtensionUpdate {
  id: string;
  name: string;
  currentVersion: string;
  availableVersion: string;
  source: string;
  permissions: Permission[];
  newPermissions: Permission[];
  reload: ReloadMode;
  signature: 'verified' | 'unsigned';
}
