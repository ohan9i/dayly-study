import type { KeyObject } from 'node:crypto';
export type BackupClient = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  storage: {
    from(bucket: string): {
      download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
    };
  };
};
export function backupClient(env?: Record<string, string | undefined>): BackupClient;
export function createBackup(
  client: BackupClient,
  publicKey: string | Buffer | KeyObject,
  directory: string,
): Promise<{ backup_id: string; sha256: string; files: number }>;
export function acknowledgeBackup(
  client: BackupClient,
  directory: string,
  artifactId: string,
): Promise<void>;
