import { afterEach, expect, test } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { encryptBackup, decryptBackup } from '../scripts/backup-crypto.mjs';
import { createBackup, acknowledgeBackup } from '../scripts/planner-backup.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 3072 });
const bytes = Buffer.from('원본 파일의 실제 바이트');
const snapshot = {
  format: 'dayly-server-backup-v1',
  backup_id: 'snapshot-test',
  tables: {
    tasks: [{ title: '개인 공부 계획' }],
    task_attachments: [
      { state: 'ready', object_path: 'space/task/file', size_bytes: bytes.length },
    ],
  },
};
const entries = [
  { type: 'database', value: snapshot },
  {
    type: 'file',
    bucket: 'task-files',
    path: 'space/task/file',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    base64: bytes.toString('base64'),
  },
];
let directory = '';
async function temp() {
  directory = await mkdtemp(join(tmpdir(), 'dayly-backup-'));
  return directory;
}
afterEach(async () => {
  if (
    directory &&
    dirname(resolve(directory)) === resolve(tmpdir()) &&
    basename(directory).startsWith('dayly-backup-')
  )
    await rm(directory, { recursive: true, force: true });
  directory = '';
});
test('encrypted backup round-trips private plan data and exact attachment bytes', async () => {
  const dir = await temp(),
    archive = join(dir, 'backup.enc'),
    output = join(dir, 'recovered');
  await encryptBackup(archive, keys.publicKey, entries);
  expect((await readFile(archive)).includes(Buffer.from('개인 공부 계획'))).toBe(false);
  expect((await decryptBackup(archive, keys.privateKey, output)).files).toBe(1);
  expect(JSON.parse(await readFile(join(output, 'database.json'), 'utf8'))).toEqual(snapshot);
  expect(await readFile(join(output, 'storage/task-files/space/task/file'))).toEqual(bytes);
});
test('tampering fails authentication without leaving extracted files', async () => {
  const dir = await temp(),
    archive = join(dir, 'backup.enc'),
    output = join(dir, 'recovered');
  await encryptBackup(archive, keys.publicKey, entries);
  const encrypted = await readFile(archive);
  encrypted[encrypted.length - 20] ^= 1;
  await writeFile(archive, encrypted);
  await expect(decryptBackup(archive, keys.privateKey, output)).rejects.toThrow();
  await expect(readFile(join(output, 'database.json'))).rejects.toThrow();
  await expect(readFile(join(output + '.partial', 'database.json'))).rejects.toThrow();
});
test('path traversal and an existing recovery directory are rejected', async () => {
  const dir = await temp(),
    archive = join(dir, 'backup.enc');
  await encryptBackup(archive, keys.publicKey, [
    entries[0],
    { ...entries[1], path: '../../escaped' },
  ]);
  await expect(decryptBackup(archive, keys.privateKey, join(dir, 'recovered'))).rejects.toThrow(
    /Invalid backup entry/,
  );
  await expect(decryptBackup(archive, keys.privateKey, dir)).rejects.toThrow(/already exists/);
});
test('missing binary aborts the backup and no success receipt is written', async () => {
  const dir = await temp();
  const client = {
    rpc: async () => ({ data: snapshot, error: null }),
    storage: {
      from: () => ({ download: async () => ({ data: null, error: { message: 'missing' } }) }),
    },
  };
  await expect(createBackup(client, keys.publicKey, dir)).rejects.toThrow(/File download failed/);
  await expect(readFile(join(dir, 'planner.dayly.enc'))).rejects.toThrow();
  await expect(readFile(join(dir, 'receipt.json'))).rejects.toThrow();
});
test('upload acknowledgement requires an artifact ID and sends only a receipt after upload', async () => {
  const dir = await temp(),
    calls: any[] = [];
  const client = {
    rpc: async (name: string, args?: unknown) => {
      calls.push({ name, args });
      return { data: snapshot, error: null };
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]), error: null }) }) },
  };
  await createBackup(client, keys.publicKey, dir);
  expect(calls.map((call) => call.name)).toEqual(['create_planner_backup_snapshot']);
  await expect(acknowledgeBackup(client, dir, '')).rejects.toThrow(/artifact upload/);
  await acknowledgeBackup(client, dir, '12345');
  expect(calls[1].name).toBe('complete_planner_backup');
  expect(calls[1].args.p_artifact_id).toBe('12345');
  expect(calls[1].args.p_archive_sha256).toHaveLength(64);
});
