// Spell pictures for the ability-icon window, out of the player's own game.
//
// Most of Panorama's pictures are a PNG inside the .vtex_c and are read at once (src/vtex.ts); the ones
// Valve compressed are decoded by the Source 2 Viewer when the player has downloaded it (src/toolchain.ts),
// the same way the item and hero pictures are (src/game-icons.ts). Without it those come back absent and
// the tile keeps its label. Cached per build of the game, so an update never shows an old picture.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sharedVpkIndex } from './vpk.ts';
import { pngFromVtex } from './vtex.ts';
import { runTool } from './toolchain.ts';
import { harvestPngs, findOutput, toolReasonFor } from './tool-output.ts';
import { folderSize } from './folder-size.ts';
import { spellPath } from './ability-icons.ts';

const MAX_PER_CALL = 60;

export function createSpellPictures({ userDataDir, toolchain, getGamePath, log = () => {} }: {
  userDataDir: string; toolchain: { pathOf: (name: string) => string | null }; getGamePath: () => string | null; log?: (msg: string) => void;
}) {
  const root = path.join(userDataDir, 'icons', 'spells');

  /** @param names  file names under spellicons, e.g. "antimage_blink_gold"; the result has the ones a picture was found for */
  async function get(names: unknown[]): Promise<{ pictures: Record<string, string>; reasons: Record<string, string> }> {
    const out: Record<string, string> = {};
    // why a picture is absent, per name: the window shows it on the tile instead of an unexplained empty square
    const reasons: Record<string, string> = {};
    const game = getGamePath();
    const pak = game ? path.join(game, 'dota', 'pak01_dir.vpk') : '';
    if (!pak || !fs.existsSync(pak)) return { pictures: out, reasons };
    // names, never paths: they end up in a file name and in the tool's filter
    const SAFE = /^[a-z0-9_]+(?:\/[a-z0-9_]+)*$/; // a file name, or folders under spellicons: never '..' or an absolute path
    const asked = [...new Set(names)].slice(0, MAX_PER_CALL);
    const valid = asked.filter((n): n is string => typeof n === 'string' && SAFE.test(n));
    for (const n of asked) if (!valid.includes(n as string) && typeof n === 'string') reasons[n] = 'имя файла иконки не прошло проверку';

    const st = fs.statSync(pak);
    const stamp = `${st.size}-${Math.floor(st.mtimeMs)}`;
    const dir = path.join(root, stamp);
    fs.mkdirSync(dir, { recursive: true });
    for (const old of fs.readdirSync(root)) if (old !== stamp) fs.rmSync(path.join(root, old), { recursive: true, force: true });
    const file = (n: string) => path.join(dir, `${n.replace(/\//g, '__')}.png`);

    const ix = sharedVpkIndex(pak);
    const left: string[] = [];
    for (const n of valid) {
      if (fs.existsSync(file(n))) continue;
      try {
        const png = pngFromVtex(ix.read(spellPath(n)));
        if (png) fs.writeFileSync(file(n), png); else { reasons[n] = 'сжатая текстура: нужен Source 2 Viewer'; left.push(n); }
      } catch (err) { log(`spell pictures: ${n} unreadable (${(err as Error)?.message || err})`); reasons[n] = `не прочиталась из игры: ${(err as Error)?.message || err}`; left.push(n); }
    }

    const exe = left.length ? toolchain.pathOf('vrf') : null;
    if (left.length && !exe) log(`spell pictures: ${left.length} compressed, Source 2 Viewer is not installed`);
    if (exe) {
      /** Run the tool for some names and copy out whatever PNGs it produced. Returns the names still missing. */
      const extract = async (list: string[]): Promise<string[]> => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-spells-'));
        let failure = '';
        let output = '';
        try {
          // The tool exits 0 even when a texture cannot be decoded (the reason is only in its text), and a
          // non-zero exit happens when one of a batch fails: so the output folder is read whatever the
          // exit code, and the text is kept to say why a picture is missing.
          try { output = await runTool(exe, ['-i', pak, '-o', tmp, '-d', '-f', list.map((n) => `panorama/images/spellicons/${n}_png.vtex_c`).join(',')]); }
          catch (err) { failure = (err as Error)?.message || String(err); log(`spell pictures: tool failed (${failure})`); }
          const found = harvestPngs(tmp);
          if (!found.size) log(`spell pictures: the tool produced no PNG for ${list.length} files (first: ${list[0]}); it said: ${output.trim().slice(0, 600)}`);
          for (const n of list) {
            const from = findOutput(found, `panorama/images/spellicons/${n}`, list.length);
            if (from) { fs.copyFileSync(from, file(n)); delete reasons[n]; }
            else reasons[n] = failure ? `Source 2 Viewer: ${failure}` : `Source 2 Viewer не создал картинку: ${toolReasonFor(output, n)}`;
          }
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
        return list.filter((n) => !fs.existsSync(file(n)));
      };
      let still = await extract(left);
      // one odd file can fail a whole batch: the rest are tried one by one (bounded, each run is about a second)
      if (still.length && still.length === left.length && left.length > 1) {
        const rest: string[] = [];
        for (const n of still.slice(0, 12)) rest.push(...await extract([n]));
        still = [...rest, ...still.slice(12)];
      }
    }

    for (const n of valid) if (fs.existsSync(file(n))) out[n] = `data:image/png;base64,${fs.readFileSync(file(n)).toString('base64')}`;
    return { pictures: out, reasons };
  }

  return { get, size: () => folderSize(root), clear: () => fs.rmSync(root, { recursive: true, force: true }) };
}
