// A small zip reader on Node's own zlib, so the window needs no extra npm package.
// Handles what release archives use: stored (0) and deflate (8) entries, no encryption, no zip64.
// Entries whose path would leave the target folder are refused (zip-slip).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function unzipTo(zipFile: string, into: string): void {
  const buf = fs.readFileSync(zipFile);
  // end-of-central-directory record: last 22+ bytes, signature 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Это не zip-архив');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const base = path.resolve(into) + path.sep;
  fs.mkdirSync(into, { recursive: true });
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Повреждён архив');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error('Зашифрованный архив не поддерживается');
    const target = path.resolve(into, name);
    if (!target.startsWith(base)) throw new Error(`unsafe path in archive: ${name}`);
    if (name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); continue; }
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('Повреждён архив');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`Метод сжатия ${method} не поддерживается`);
    if (data.length !== usize) throw new Error(`Размер файла не совпал: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}
