import type { KeyObject } from 'node:crypto';
export function encryptBackup(
  path: string,
  publicKey: string | Buffer | KeyObject,
  entries: Iterable<unknown> | AsyncIterable<unknown>,
): Promise<string>;
export function decryptBackup(
  path: string,
  privateKey: string | Buffer | KeyObject,
  directory: string,
): Promise<{ files: number }>;
