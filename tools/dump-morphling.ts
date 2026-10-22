// Usage: node tools/dump-morphling.ts ["<...>/dota 2 beta/game"] [outDir]   (no path: found the way the app finds it)
// Pulls the four Morphling model files out of the game's pak01 with the app's own VPK reader.
import fs from 'node:fs';
import path from 'node:path';
import { sharedVpkIndex } from '../src/vpk.ts';
import { findDotaGamePath } from '../src/steam.ts';

const game = process.argv[2] || await findDotaGamePath();
const out = path.resolve(process.argv[3] || 'morphling-dump');
if (!game) { console.error('Dota 2 not found: give the path to ".../dota 2 beta/game"'); process.exit(1); }
console.log('game: ' + game);
const pak = path.join(game, 'dota', 'pak01_dir.vpk');
if (!fs.existsSync(pak)) { console.error('not found: ' + pak); process.exit(1); }
const ix = sharedVpkIndex(pak);
for (const p of [
  'models/heroes/morphling/morphling.vmdl_c',
  'models/items/morphling/tritons_revenge_head/tritons_revenge_head.vmdl_c',
  'models/items/morphling/abyss_overlord_back/abyss_overlord_back.vmdl_c',
  'models/items/morphling/ethereal_blade/ethereal_blade.vmdl_c',
]) {
  const data = ix.read(p);
  if (!data) { console.log('MISSING ' + p); continue; }
  const f = path.join(out, p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  console.log('ok ' + data.length + '  ' + p);
}
console.log('done -> ' + out);
