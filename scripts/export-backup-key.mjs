import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';

try {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination)
    throw new Error(
      'Usage: pipe a password to node scripts/export-backup-key.mjs <protected-key> <new-portable-key.pem>',
    );
  let password = '';
  for await (const chunk of process.stdin) password += chunk.toString('utf8');
  password = password.trimEnd();
  if (password.length < 16)
    throw new Error('Use a portable-key password of at least 16 characters');
  let key = await readFile(source, 'utf8');
  if (source.endsWith('.dpapi')) {
    if (process.platform !== 'win32')
      throw new Error('Protected key requires the original Windows account');
    key = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$s=ConvertTo-SecureString -String ([Console]::In.ReadToEnd()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }',
      ],
      { input: key, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  }
  const portable = createPrivateKey(key).export({
    format: 'pem',
    type: 'pkcs8',
    cipher: 'aes-256-cbc',
    passphrase: password,
  });
  await writeFile(destination, portable, { flag: 'wx', mode: 0o600 });
  console.log(
    'Password-encrypted portable recovery key exported. Store it and its password separately.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
