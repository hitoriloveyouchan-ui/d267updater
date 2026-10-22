// Spell pictures: a texture that carries a PNG is read at once; a compressed one is absent without the tool.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { buildVpk, entryAt } from '../src/vpk.ts';
import { createSpellPictures } from '../src/spell-pictures.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dota-spells-'));
const game = path.join(root, 'game');
fs.mkdirSync(path.join(game, 'dota'), { recursive: true });

// a real 1x1 PNG
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => { const t = Buffer.concat([Buffer.from(type), data]); const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(t)); return Buffer.concat([l, t, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
const header = Buffer.alloc(32); header.writeUInt32LE(32, 0);
const vtex = Buffer.concat([header, png]);

fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([
  entryAt('panorama/images/spellicons/antimage_blink_png.vtex_c', vtex),
  entryAt('panorama/images/spellicons/antimage_blink_gold_png.vtex_c', Buffer.from('COMPRESSED-NOT-A-PNG-AT-ALL-0123456789')),
]));

const sp = createSpellPictures({ userDataDir: path.join(root, 'data'), toolchain: { pathOf: () => null }, getGamePath: () => game });
const { pictures: got, reasons } = await sp.get(['antimage_blink', 'antimage_blink_gold', 'not_there', '../evil', 42]);
assert.deepEqual(Object.keys(got), ['antimage_blink'], 'only the readable one, and no path-like names');
assert.equal(got.antimage_blink, `data:image/png;base64,${png.toString('base64')}`);
assert.match(reasons.antimage_blink_gold, /Source 2 Viewer/, 'a missing picture says why');
assert.ok(sp.size() > 0);
sp.clear();
assert.equal(sp.size(), 0);
console.log('SPELL PICTURES OK');
