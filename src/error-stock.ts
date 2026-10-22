// A pick whose slot has no model of its own to stand on (Morphling's) shows as ERROR once the player
// reconnects to the match. These four files make the game's error model invisible and its error particle
// empty, so what is left of such a pick is nothing instead of a red ERROR. Same trick the reference pack uses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryAt, type VpkEntry } from './vpk-write.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'error-stock');

function walk(dir: string, rel = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name), `${rel}${d.name}/`) : [`${rel}${d.name}`]);
}

/** The invisible error material and the empty error particles, as entries for the mod's VPK. */
export function errorStockEntries(): VpkEntry[] {
  return walk(ROOT).map((p) => entryAt(p, fs.readFileSync(path.join(ROOT, p))));
}
