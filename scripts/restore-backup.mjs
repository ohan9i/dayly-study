import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { decryptBackup } from './backup-crypto.mjs';
import { createPrivateKey } from 'node:crypto';

const [archive, keyPath, directory] = process.argv.slice(2);
try {
  if (!archive || !keyPath || !directory)
    throw new Error(
      'Usage: node scripts/restore-backup.mjs <archive.dayly.enc> <private-key.pem-or-dpapi> <new-output-directory>',
    );
  let key = await readFile(keyPath, 'utf8');
  if (keyPath.endsWith('.dpapi')) {
    if (process.platform !== 'win32')
      throw new Error('This protected key requires the original Windows account');
    key = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $s=ConvertTo-SecureString -String ([Console]::In.ReadToEnd()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }",
      ],
      { input: key, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  }
  if (key.includes('BEGIN ENCRYPTED PRIVATE KEY')) {
    if (!process.argv.includes('--passphrase-stdin'))
      throw new Error(
        'Encrypted portable key requires --passphrase-stdin and a local secure password prompt',
      );
    let password = '';
    for await (const chunk of process.stdin) password += chunk.toString('utf8');
    key = createPrivateKey({ key, passphrase: password.trimEnd() });
  }
  const result = await decryptBackup(archive, key, directory);
  console.log(
    `Verified backup extracted (${result.files} files). Database changes have not been applied.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
