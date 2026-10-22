// What Source 2 Viewer leaves in the folder it was given, read without trusting its layout.
//
// The tool writes decompiled textures as <name>_png.png, normally under the archive's own folders
// (panorama/images/...); with a filter that matches exactly one file its help says the output path
// is treated differently, so the picture may land flat. And it exits 0 when a texture cannot be
// decoded, writing the reason into its output only. So callers index whatever PNGs exist by base name
// and read the reason from the text.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every PNG under `dir`, keyed by its path below `dir` without the extension and the compiled "_png"
 * ("panorama/images/spellicons/antimage_blink_gold"), lower case, forward slashes.
 *
 * By the whole path and not the file name: the same name sits in several folders (an item's icon
 * folder holds a picture named after the ability for each item), and by name alone they overwrite
 * each other, so every tile came out with the last one's picture.
 */
export function harvestPngs(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.png$/i.test(e.name)) continue;
      const rel = path.relative(dir, full).split(path.sep).join('/').replace(/\.png$/i, '').replace(/_png$/i, '').toLowerCase();
      found.set(rel, full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

/**
 * The file the tool wrote for one wanted path (no extension, no "_png": "panorama/images/spellicons/x").
 * Where it wrote it flat (the tool's help says a filter matching one file is treated differently), the
 * only PNG there is, is that file's: with more than one wanted file a bare name is never trusted.
 */
export function findOutput(found: Map<string, string>, wanted: string, wantedCount: number): string | undefined {
  const exact = found.get(wanted.toLowerCase());
  if (exact) return exact;
  if (wantedCount === 1 && found.size === 1) return [...found.values()][0];
  return undefined;
}

/** The tool's own explanation for one file, from its output: the exception line that follows "File: <path>". */
export function toolReasonFor(output: string, name: string): string {
  const lines = output.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith('File:') && l.toLowerCase().includes(`/${name.toLowerCase()}_png`));
  if (at >= 0) {
    const err = lines.slice(at + 1).find((l) => /exception|error|unsupported|not supported/i.test(l));
    if (err) return err.trim().slice(0, 220);
  }
  const any = lines.find((l) => /exception|error|unsupported/i.test(l));
  return any ? any.trim().slice(0, 220) : 'в выводе программы нет ни картинки, ни ошибки';
}
