import {
  createCipheriv,
  createDecipheriv,
  createHash,
  publicEncrypt,
  privateDecrypt,
  randomBytes,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, rename, rm, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGzip, createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

export async function encryptBackup(path, publicKey, entries) {
  const key = randomBytes(32),
    iv = randomBytes(12);
  const header = Buffer.from(
    JSON.stringify({
      format: 'dayly-encrypted-backup-v1',
      cipher: 'AES-256-GCM',
      compression: 'gzip',
      wrappedKey: publicEncrypt({ key: publicKey, oaepHash: 'sha256' }, key).toString('base64'),
      iv: iv.toString('base64'),
    }) + '\n',
  );
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.partial';
  try {
    await writeFile(temporary, header, { mode: 0o600 });
    async function* lines() {
      for await (const entry of entries) yield JSON.stringify(entry) + '\n';
    }
    await pipeline(
      Readable.from(lines()),
      createGzip(),
      cipher,
      createWriteStream(temporary, { flags: 'a', mode: 0o600 }),
    );
    await appendFile(temporary, cipher.getAuthTag());
    await rename(temporary, path);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  } finally {
    key.fill(0);
  }
}

export async function decryptBackup(path, privateKey, directory) {
  // A new staging directory avoids overwriting another recovery or extracting
  // any unauthenticated plaintext into a user-visible location.
  const staging = resolve(directory) + '.partial';
  await mkdir(staging, { recursive: false, mode: 0o700 });
  let handle;
  try {
    // Refuse an existing final directory, even when it contains no files.
    try {
      const existing = await open(resolve(directory));
      await existing.close();
      throw new Error('Recovery directory already exists');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    handle = await open(path, 'r');
    const { size } = await handle.stat();
    const prefix = Buffer.alloc(Math.min(size, 16384));
    await handle.read(prefix, 0, prefix.length, 0);
    const end = prefix.indexOf(10);
    if (end < 0 || size <= end + 17) throw new Error('Invalid encrypted backup');
    const headerBytes = prefix.subarray(0, end + 1);
    const header = JSON.parse(headerBytes.toString('utf8'));
    if (
      header.format !== 'dayly-encrypted-backup-v1' ||
      header.cipher !== 'AES-256-GCM' ||
      header.compression !== 'gzip'
    )
      throw new Error('Unsupported encrypted backup');
    const key = privateDecrypt(
      { key: privateKey, oaepHash: 'sha256' },
      Buffer.from(header.wrappedKey, 'base64'),
    );
    const iv = Buffer.from(header.iv, 'base64');
    if (key.length !== 32 || iv.length !== 12) throw new Error('Invalid encryption parameters');
    const tag = Buffer.alloc(16);
    await handle.read(tag, 0, 16, size - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(tag);
    const compressed = join(staging, 'authenticated.gz');
    try {
      await pipeline(
        createReadStream(path, { start: end + 1, end: size - 17 }),
        decipher,
        createWriteStream(compressed, { mode: 0o600 }),
      );
    } finally {
      key.fill(0);
    }
    // Integrity/authentication is verified BEFORE parsing paths or creating files.
    const source = createReadStream(compressed);
    const gunzip = createGunzip();
    const pumping = pipeline(source, gunzip);
    void pumping.catch(() => {});
    const lines = createInterface({ input: gunzip, crlfDelay: Infinity });
    let database = false,
      count = 0;
    try {
      for await (const line of lines) {
        const entry = JSON.parse(line);
        if (
          entry.type === 'database' &&
          !database &&
          entry.value?.format === 'dayly-server-backup-v1'
        ) {
          await writeFile(join(staging, 'database.json'), JSON.stringify(entry.value, null, 2), {
            flag: 'wx',
            mode: 0o600,
          });
          database = true;
        } else if (
          entry.type === 'file' &&
          entry.bucket === 'task-files' &&
          /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(entry.path)
        ) {
          const bytes = Buffer.from(entry.base64, 'base64');
          if (
            bytes.length !== entry.size ||
            createHash('sha256').update(bytes).digest('hex') !== entry.sha256
          )
            throw new Error('File integrity check failed');
          const destination = join(staging, 'storage', entry.bucket, entry.path);
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
          count++;
        } else throw new Error('Invalid backup entry');
      }
      await pumping;
    } catch (error) {
      source.destroy();
      gunzip.destroy();
      await pumping.catch(() => {});
      throw error;
    }
    if (!database) throw new Error('Backup database is missing');
    await rm(compressed);
    await rename(staging, resolve(directory));
    return { files: count };
  } catch (error) {
    if (
      resolve(staging) !== resolve(directory) + '.partial' ||
      dirname(staging) !== dirname(resolve(directory)) ||
      (await lstat(staging)).isSymbolicLink()
    )
      throw new Error('Unsafe recovery cleanup target');
    await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await handle?.close();
  }
}
