// Smoke test on a synthetic Dota tree: patch on -> pick -> pak built -> patch off -> byte-exact restore.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createCosmetics } from '../src/cosmetics.ts';
import { buildVpk, entryAt } from '../src/vpk.ts';
import { signatureLine, fileHashes } from '../src/patcher-signatures.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dota-'));
const game = path.join(root, 'game');
fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
fs.mkdirSync(path.join(game, 'bin', process.platform === 'linux' ? 'linuxsteamrt64' : 'win64'), { recursive: true });

const items = `"items_game"\r\n{\r\n\t"items"\r\n\t{\r\n` +
`\t\t"555"\r\n\t\t{\r\n\t\t\t"name"\t"Default Weather"\r\n\t\t\t"prefab"\t"weather"\r\n\t\t\t"baseitem"\t"1"\r\n\t\t\t"visuals"\r\n\t\t\t{\r\n\t\t\t\t"particle"\t"default.vpcf"\r\n\t\t\t}\r\n\t\t}\r\n` +
`\t\t"556"\r\n\t\t{\r\n\t\t\t"name"\t"Snow"\r\n\t\t\t"prefab"\t"weather"\r\n\t\t\t"visuals"\r\n\t\t\t{\r\n\t\t\t\t"particle"\t"snow.vpcf"\r\n\t\t\t\t"unlock"\r\n\t\t\t\t{\r\n\t\t\t\t\t"x"\t"1"\r\n\t\t\t\t}\r\n\t\t\t}\r\n\t\t}\r\n` +
Array.from({ length: 1200 }, (_, i) => `\t\t"${1000 + i}"\r\n\t\t{\r\n\t\t\t"name"\t"filler ${i}"\r\n\t\t}\r\n`).join('') + `\t}\r\n}\r\n`;
fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([entryAt('scripts/items/items_game.txt', Buffer.from(items, 'latin1'))]));

const gi = `"GameInfo"\r\n{\r\n\tFileSystem\r\n\t{\r\n\t\tSearchPaths\r\n\t\t{\r\n\t\t\tGame\tdota\r\n\t\t\tMod\tdota\r\n\t\t\tGame\tcore\r\n\t\t}\r\n\t}\r\n}\r\n`;
const branch = `"GameInfo"\r\n{\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t570\r\n\t}\r\n}\r\n`;
fs.writeFileSync(path.join(game, 'dota', 'gameinfo.gi'), gi);
fs.writeFileSync(path.join(game, 'dota', 'gameinfo_branchspecific.gi'), branch);
const { sha1, crc } = fileHashes(Buffer.from(branch, 'latin1'));
const sigPath = path.join(game, 'bin', process.platform === 'linux' ? 'linuxsteamrt64' : 'win64', 'dota.signatures');
const sigOrig = `dota2.exe~SHA1:AAAA;CRC:BBBB\r\n...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:${sha1};CRC:${crc}\r\nDIGEST:1234\r\n`;
fs.writeFileSync(sigPath, sigOrig);

const data = path.join(root, 'data');
const c = createCosmetics({ gamePath: game, dataDir: data });

let slots = c.slots();
console.log('slots:', JSON.stringify(slots));
assert.equal(slots[0].slot, 'weather');

assert.throws(() => c.pick('weather', '556'), /Безопасный режим/);

const r = c.setEnabled(true);
console.log('enabled ->', r, c.state());
let st = c.state();
assert.ok(st.patched && st.signed && st.enabled);

const p = c.pick('weather', '556');
console.log('pick ->', p);
assert.ok(p.deployed && p.applied === 1);
assert.ok(fs.existsSync(path.join(game, 'dota_russian', 'pak99_dir.vpk')));
console.log('branch now:\n' + fs.readFileSync(path.join(game, 'dota', 'gameinfo_branchspecific.gi'), 'latin1'));

c.setEnabled(false);
assert.equal(fs.readFileSync(path.join(game, 'dota', 'gameinfo_branchspecific.gi'), 'latin1'), branch, 'branch restored byte for byte');
assert.equal(fs.readFileSync(sigPath, 'latin1'), sigOrig, 'signatures restored byte for byte');
assert.ok(!fs.existsSync(path.join(game, 'dota_russian', 'pak99_dir.vpk')), 'our pak removed');
console.log('state after off:', c.state());
console.log('SMOKE OK');
