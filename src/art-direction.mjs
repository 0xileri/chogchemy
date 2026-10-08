import { readFileSync } from 'node:fs';
import { resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Reference images must be PNG, JPEG, or WebP.');
}
export function loadArtDirection(root = fileURLToPath(new URL('../', import.meta.url))) {
  const config = JSON.parse(readFileSync(resolve(root, 'art-direction.json'), 'utf8'));
  if (typeof config.label !== 'string' || !Array.isArray(config.rules) || !config.rules.length || config.rules.some(r => typeof r !== 'string') || !Array.isArray(config.references) || config.references.length > 4) throw new Error('Invalid art-direction.json.');
  const referenceRoot = resolve(root, 'assets/artist');
  const images = config.references.map(name => {
    if (typeof name !== 'string') throw new Error('Invalid artist reference filename.');
    const path = resolve(referenceRoot, name);
    if (!path.startsWith(referenceRoot + sep)) throw new Error('Artist references must stay in assets/artist.');
    const bytes = readFileSync(path);
    if (bytes.length > 12 * 1024 * 1024) throw new Error('Artist reference exceeds 12 MB.');
    return { name: basename(path), bytes, mime: imageMime(bytes), digest: digest(bytes) };
  });
  const snapshot = { version: String(config.version), label: config.label, description: String(config.description || ''), rules: config.rules, references: images.map(({ name, digest, mime }) => ({ name, digest, mime })) };
  return { ...snapshot, hash: digest(JSON.stringify(snapshot)), images };
}
