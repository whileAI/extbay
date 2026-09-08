import path from 'node:path';

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export const config = {
  listen: process.env.EXTBAY_LISTEN ?? '0.0.0.0:9444',
  tlsListen: process.env.EXTBAY_TLS_LISTEN,
  tlsCert: process.env.EXTBAY_TLS_CERT,
  tlsKey: process.env.EXTBAY_TLS_KEY,
  data: path.resolve(process.env.EXTBAY_DATA ?? '/data'),
  portainerUrl: new URL(process.env.EXTBAY_PORTAINER_URL ?? 'http://portainer:9000'),
  publicOrigin: process.env.EXTBAY_PUBLIC_ORIGIN,
  panelContainer: process.env.EXTBAY_PANEL_CONTAINER,
  limits: {
    maxArchiveBytes: positiveInteger('EXTBAY_MAX_ARCHIVE_BYTES', 50 * 1024 * 1024),
    maxFiles: positiveInteger('EXTBAY_MAX_FILES', 2048),
    maxUnpackedBytes: positiveInteger('EXTBAY_MAX_UNPACKED_BYTES', 200 * 1024 * 1024),
  },
};
