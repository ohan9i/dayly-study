import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

try {
  const repository = process.argv[2];
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || ''))
    throw new Error('Usage: node scripts/setup-backup-key.mjs owner/repository');
  const directory = '.local/backup-keys';
  await mkdir(directory, { recursive: true });
  const privatePath = join(
    directory,
    process.platform === 'win32' ? 'private-key.dpapi' : 'private-key.pem',
  );
  const publicPath = join(directory, 'public-key.pem');
  let publicKey;
  try {
    publicKey = await readFile(publicPath, 'utf8');
    await readFile(privatePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Never rotate an existing GitHub key when its private key is unavailable.
    let remoteExists = false;
    try {
      execFileSync('gh', ['api', `repos/${repository}/actions/variables/DAYLY_BACKUP_PUBLIC_KEY`], {
        stdio: 'pipe',
      });
      remoteExists = true;
    } catch (error) {
      if (!String(error.stderr).includes('HTTP 404'))
        throw new Error('Cannot verify existing encryption configuration; no key was generated');
    }
    if (remoteExists)
      throw new Error(
        'An encryption key is already configured; recover its private key before continuing',
      );
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKey = pair.publicKey;
    let protectedKey = pair.privateKey;
    if (process.platform === 'win32')
      protectedKey = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::Write((ConvertFrom-SecureString (ConvertTo-SecureString -String ([Console]::In.ReadToEnd()) -AsPlainText -Force)))',
        ],
        { input: pair.privateKey, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
    await writeFile(privatePath, protectedKey, { flag: 'wx', mode: 0o600 });
    await writeFile(publicPath, publicKey, { flag: 'wx', mode: 0o600 });
  }
  try {
    const configured = JSON.parse(
      execFileSync('gh', ['api', `repos/${repository}/actions/variables/DAYLY_BACKUP_PUBLIC_KEY`], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    );
    if (configured.value.trim() !== publicKey.trim())
      throw new Error(
        'Configured public key differs; key rotation requires retaining the existing private key',
      );
  } catch (error) {
    if (!String(error.stderr).includes('HTTP 404')) throw error;
  }
  execFileSync('gh', ['variable', 'set', 'DAYLY_BACKUP_PUBLIC_KEY', '--repo', repository], {
    input: publicKey,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log(`Public encryption key configured. Recovery key: ${privatePath}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
