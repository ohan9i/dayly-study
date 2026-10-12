import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encryptBackup } from './backup-crypto.mjs';

export function backupClient(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_BACKUP_SECRET_KEY)
    throw new Error('Set SUPABASE_URL and SUPABASE_BACKUP_SECRET_KEY in GitHub Actions');
  const key = env.SUPABASE_BACKUP_SECRET_KEY;
  if (!key.startsWith('sb_secret_')) {
    let role;
    try {
      role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
    } catch {
      /* Reject non-server keys. */
    }
    if (role !== 'service_role')
      throw new Error(
        'Backup requires a server secret key; a publishable/anon key is not accepted',
      );
  }
  return createClient(env.SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
export async function createBackup(client, publicKey, directory) {
  const result = await client.rpc('create_planner_backup_snapshot');
  if (result.error)
    throw new Error(
      `Snapshot request failed (${result.error.code || 'connection'}); no backup was completed`,
    );
  const snapshot = result.data;
  if (snapshot?.format !== 'dayly-server-backup-v1' || !snapshot.backup_id || !snapshot.tables)
    throw new Error('Invalid server snapshot');
  let files = 0;
  async function* entries() {
    yield { type: 'database', value: snapshot };
    const paths = new Set();
    for (const file of snapshot.tables.task_attachments || []) {
      if (file.state !== 'ready' || paths.has(file.object_path)) continue;
      paths.add(file.object_path);
      const result = await client.storage.from('task-files').download(file.object_path);
      if (result.error)
        throw new Error('File download failed; retry the backup after concurrent changes finish');
      const bytes = Buffer.from(await result.data.arrayBuffer());
      if (bytes.length !== file.size_bytes)
        throw new Error('File size mismatch; backup was not completed');
      files++;
      yield {
        type: 'file',
        bucket: 'task-files',
        path: file.object_path,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        base64: bytes.toString('base64'),
      };
    }
  }
  const digest = await encryptBackup(join(directory, 'planner.dayly.enc'), publicKey, entries());
  const receipt = { backup_id: snapshot.backup_id, sha256: digest, files };
  await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt), { mode: 0o600 });
  return receipt;
}
export async function acknowledgeBackup(client, directory, artifactId) {
  if (!/^[0-9]+$/.test(artifactId || ''))
    throw new Error('A successful GitHub artifact upload is required');
  const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
  const result = await client.rpc('complete_planner_backup', {
    p_backup_id: receipt.backup_id,
    p_artifact_id: artifactId,
    p_archive_sha256: receipt.sha256,
  });
  if (result.error)
    throw new Error('Backup uploaded but server receipt failed; inspect this workflow run');
}
if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(
    '/' + process.argv[1].replaceAll('\\', '/').split('/').pop(),
  )
) {
  try {
    const client = backupClient();
    const directory = process.env.BACKUP_OUTPUT_DIRECTORY || 'backup-output';
    if (process.argv[2] === 'acknowledge') {
      await acknowledgeBackup(client, directory, process.env.BACKUP_ARTIFACT_ID);
      console.log('Encrypted backup upload confirmed.');
    } else {
      if (!process.env.DAYLY_BACKUP_PUBLIC_KEY)
        throw new Error('Set DAYLY_BACKUP_PUBLIC_KEY before enabling backups');
      const receipt = await createBackup(client, process.env.DAYLY_BACKUP_PUBLIC_KEY, directory);
      console.log(`Encrypted planner backup created (${receipt.files} files).`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
