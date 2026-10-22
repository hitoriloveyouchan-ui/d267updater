// The one tool this window can borrow: Source 2 Viewer (ValveResourceFormat, MIT), fetched only
// when the user says yes. Reworked from Dota 2 Mod Manager's src/toolchain.ts (GPL-3.0): the same
// pin (version + URL + SHA-256, nothing runs that did not hash to it) but without the app-wide
// download/mirror/transaction machinery this window does not have.
//
// What it is for: almost every item icon is a PNG inside a .vtex_c and is read without it
// (src/vtex.ts); the ones Valve stored block-compressed need this program. ~50 MB, kept in the app's
// own folder, removable from Settings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { unzipTo } from './unzip.ts';

interface Pin { version: string; url: string; sha256: string; bytes: number; exe: string; license: string; project: string }
type Installed = { version: string; exe: string; sha256: string; at: number; build: string };

export type ToolProgress =
  | { type: 'stage'; label: string; stage: string }
  | { type: 'download'; label: string; loaded: number; total: number }
  | { type: 'done'; label: string }
  | { type: 'error'; label: string; message: string };

export const HOST_BUILD = `${process.platform}-${process.arch}`;

const VRF = { version: '20.0', license: 'MIT', project: 'https://github.com/ValveResourceFormat/ValveResourceFormat' };
const VRF_RELEASE = 'https://github.com/ValveResourceFormat/ValveResourceFormat/releases/download/20.0';
export const BUILT_IN_PINS: Record<string, Record<string, Pin>> = {
  vrf: {
    'win32-x64': { ...VRF, url: `${VRF_RELEASE}/cli-windows-x64.zip`, bytes: 52735867, exe: 'Source2Viewer-CLI.exe',
      sha256: 'd32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5' },
    'linux-x64': { ...VRF, url: `${VRF_RELEASE}/cli-linux-x64.zip`, bytes: 53059004, exe: 'Source2Viewer-CLI',
      sha256: '3e8af47cd6ce52e8068904f2aa1dda23c56a6b96a8310b25090f0711cda76a8a' },
  },
};
const TOOL_NAMES = Object.keys(BUILT_IN_PINS);
export const pinFor = (name: string, build: string = HOST_BUILD): Pin | null => BUILT_IN_PINS[name]?.[build] || null;

// A copy of the same archive in the original project's bucket, for when GitHub is unreachable.
// Safe: the digest is pinned here, so whoever hands over the bytes cannot choose what they hash to.
const FALLBACK_BASE = 'https://cdn.dota2modmanager.com/tools/';
const fallbackName = (name: string, version: string, build: string) =>
  build === 'win32-x64' ? `${name}-${version}.zip` : `${name}-${version}-${build}.zip`;

const TOOL_TIMEOUT_MS = 60000;

/** Run a tool, hidden; resolved with what it printed on exit 0, rejected otherwise. */
export function runTool(exe: string, args: string[], { timeoutMs = TOOL_TIMEOUT_MS } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(`${stdout || ''}\n${stderr || ''}`);
      // the tool's own last words say why (a texture it cannot decode, a bad filter...); the exit code alone does not
      const tail = `${stderr || ''}\n${stdout || ''}`.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 400);
      const why = (err as any).killed ? `не уложился в ${Math.round(timeoutMs / 1000)} с` : `код ${(err as any).code ?? '?'}`;
      reject(new Error(tail ? `${why}: ${tail}` : why));
    });
  });
}

type FetchLike = (url: string, init?: any) => Promise<Response>;

/** Stream a URL to a file, checking the SHA-256 and reporting progress. Throws on any mismatch. */
async function download(fetchImpl: FetchLike, url: string, dest: string, sha256: string, total: number,
  onBytes: (loaded: number, total: number) => void): Promise<string> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const size = Number(res.headers.get('content-length')) || total;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  let loaded = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      loaded += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      onBytes(loaded, size);
    }
    await new Promise<void>((resolve, reject) => { out.end((e?: Error | null) => (e ? reject(e) : resolve())); });
  } catch (err) {
    out.destroy();
    fs.rmSync(dest, { force: true });
    throw err;
  }
  const got = hash.digest('hex');
  if (got !== sha256.toLowerCase()) {
    fs.rmSync(dest, { force: true });
    throw new Error('Контрольная сумма скачанного файла не совпала: файл не используется.');
  }
  return got;
}

export function createToolchain({ userDataDir, fetchImpl = globalThis.fetch as FetchLike, onProgress = () => {}, log = () => {}, build = HOST_BUILD }: {
  userDataDir: string; fetchImpl?: FetchLike; onProgress?: (evt: ToolProgress) => void; log?: (msg: string) => void; build?: string;
}) {
  const root = path.join(userDataDir, 'toolchain');
  const dirFor = (name: string, version: string) => path.join(root, name, version);
  const stateFile = path.join(root, 'installed.json');
  let busy: Promise<string> | null = null;

  const installed = (): Record<string, Installed> => {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf-8')); } catch { return {}; }
  };
  function remember(name: string, entry: Installed | null): void {
    const all = installed();
    if (entry) all[name] = entry; else delete all[name];
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(all, null, 2));
  }

  /** Where the tool's executable sits now, or null if it is not downloaded (or is for another machine). */
  function pathOf(name: string): string | null {
    const entry = installed()[name];
    if (!entry || entry.build !== build) return null;
    const exe = path.join(dirFor(name, entry.version), entry.exe);
    return fs.existsSync(exe) ? exe : null;
  }

  async function ensure(name: string): Promise<string> {
    if (!TOOL_NAMES.includes(name)) throw new Error(`unknown tool ${name}`);
    const pin = pinFor(name, build);
    if (!pin) throw new Error(`Для этой системы (${build}) нет сборки ${name}.`);
    const have = installed()[name];
    if (have && have.version === pin.version) { const exe = pathOf(name); if (exe) return exe; }
    if (busy) return busy; // a second click joins the download in progress
    busy = (async () => {
      try {
        const exe = await fetchAndUnpack(name, pin);
        onProgress({ type: 'done', label: name });
        return exe;
      } catch (err) {
        onProgress({ type: 'error', label: name, message: String((err as Error)?.message || err) });
        throw err;
      } finally { busy = null; }
    })();
    return busy;
  }

  async function fetchAndUnpack(name: string, pin: Pin): Promise<string> {
    const dest = path.join(root, `${name}-${pin.version}.zip`);
    onProgress({ type: 'stage', label: name, stage: 'download' });
    const onBytes = (loaded: number, total: number) => onProgress({ type: 'download', label: name, loaded, total });
    let sha: string;
    try {
      sha = await download(fetchImpl, pin.url, dest, pin.sha256, pin.bytes, onBytes);
    } catch (err) {
      const spare = FALLBACK_BASE + fallbackName(name, pin.version, build);
      log(`toolchain: release unavailable (${(err as Error)?.message || err}), trying ${spare}`);
      try { sha = await download(fetchImpl, spare, dest, pin.sha256, pin.bytes, onBytes); }
      catch { throw err; } // the first error is the one worth reading
    }
    onProgress({ type: 'stage', label: name, stage: 'unpack' });

    // unpacked into a fresh folder; entries that would leave it are refused (zip-slip)
    const into = dirFor(name, pin.version);
    fs.rmSync(into, { recursive: true, force: true });
    fs.mkdirSync(into, { recursive: true });
    try {
      unzipTo(dest, into);
    } catch (err) {
      fs.rmSync(into, { recursive: true, force: true });
      throw err;
    } finally { fs.rmSync(dest, { force: true }); }

    const exe = path.join(into, pin.exe);
    if (!fs.existsSync(exe)) {
      fs.rmSync(into, { recursive: true, force: true });
      throw new Error(`${pin.exe} не найден в архиве`);
    }
    if (!build.startsWith('win32')) fs.chmodSync(exe, 0o755);
    remember(name, { version: pin.version, exe: pin.exe, sha256: sha, at: Date.now(), build });
    for (const old of fs.readdirSync(path.join(root, name))) {
      if (old !== pin.version) fs.rmSync(path.join(root, name, old), { recursive: true, force: true });
    }
    log(`toolchain: ${name} ${pin.version} installed`);
    return exe;
  }

  /** What is on disk, for Settings and the first-run offer. */
  function state() {
    const have = installed();
    return TOOL_NAMES.map((name) => {
      const entry = have[name] || null;
      const dir = entry ? dirFor(name, entry.version) : null;
      let bytes = 0;
      if (dir) { try { for (const f of fs.readdirSync(dir)) bytes += fs.statSync(path.join(dir, f)).size; } catch { /* gone */ } }
      const pin = pinFor(name, build);
      return {
        name, version: entry ? entry.version : null, latest: pin?.version ?? null,
        installedBytes: bytes, downloadBytes: pin?.bytes || 0, license: pin?.license ?? null, project: pin?.project ?? null,
        available: !!pin, ready: !!pathOf(name),
      };
    });
  }

  function remove(name: string): void {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
    remember(name, null);
  }

  return { ensure, pathOf, state, remove, root, TOOL_NAMES };
}
