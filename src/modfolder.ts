// Where this app's files go: the game's language folder (game/dota_russian, dota_koreana or dota_schinese),
// the same place Dota 2 Mod Manager puts mods. Which one is decided by the game's own audio language
// (src/gamelang.ts has the rule; English has no folder of its own and borrows dota_russian).
//
// The patch in gameinfo_branchspecific.gi registers this folder explicitly, so it is read whatever the
// audio language is and nothing in the player's boot.vcfg has to change.
import fs from 'node:fs';
import path from 'node:path';
import * as gamelang from './gamelang.ts';

/** The folder name, e.g. "dota_russian". */
export function modFolderName(gamePath: string): string {
  const lang = gamelang.detectLangSuffix(gamePath);
  const chosen = gamelang.modFolderFor(gamelang.launchLanguage(gamePath), lang.suffix);
  return `dota_${chosen.suffix}`;
}

// what Valve puts in every official language folder; mirrored only when the folder does not exist yet
const gameinfoStub = (suffix: string) => `"GameInfo"
{
	LayeredOnMod	dota

	FileSystem
	{
		SearchPaths
		{
			Game				dota_${suffix}
			Game				dota
			Game				core

			Mod					dota_${suffix}
			Mod					dota

			AddonRoot			dota_addons

			// Note: addon content is included in publiccontent by default.
			PublicContent		core
		}
	}
}
`;

/** Make sure the folder exists. A gameinfo.gi is written only into a folder created here; one that was already there is left alone. */
export function ensureModFolder(gamePath: string, folder: string): string {
  const dir = path.join(gamePath, folder);
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  if (!existed) {
    try { fs.writeFileSync(path.join(dir, 'gameinfo.gi'), gameinfoStub(folder.replace(/^dota_/, '')), { flag: 'wx' }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err; }
  }
  return dir;
}
