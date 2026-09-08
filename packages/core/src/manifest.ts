import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import semver from 'semver';
import type { Manifest } from './types.js';

const require = createRequire(import.meta.url);
const schemaPath = require.resolve('../../../schemas/extbay.schema.json');
let validator: ValidateFunction<Manifest> | undefined;

async function getValidator(): Promise<ValidateFunction<Manifest>> {
  if (validator) return validator;
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as object;
  const Ajv2020 = (require('ajv/dist/2020.js') as { default: new (options: Record<string, unknown>) => { compile<T>(schema: object): ValidateFunction<T> } }).default;
  const addFormats = (require('ajv-formats') as { default: (ajv: object) => unknown }).default;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  validator = ajv.compile<Manifest>(schema);
  return validator!;
}

export class ManifestValidationError extends Error {
  constructor(public readonly errors: ErrorObject[]) {
    super(errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; '));
    this.name = 'ManifestValidationError';
  }
}

export async function validateManifest(input: unknown): Promise<Manifest> {
  const validate = await getValidator();
  if (!validate(input)) throw new ManifestValidationError(validate.errors ?? []);
  return structuredClone(input);
}

export function assertCompatible(manifest: Manifest, portainerVersion: string, extbayVersion: string): void {
  const portainer = semver.coerce(portainerVersion);
  if (!portainer || !semver.satisfies(portainer, manifest.compatibility.portainer, { includePrerelease: true })) {
    throw new Error(`Portainer ${portainerVersion} does not satisfy ${manifest.compatibility.portainer}`);
  }
  if (manifest.compatibility.extbay && !semver.satisfies(extbayVersion, manifest.compatibility.extbay, { includePrerelease: true })) {
    throw new Error(`ExtBay ${extbayVersion} does not satisfy ${manifest.compatibility.extbay}`);
  }
}
