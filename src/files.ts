import type { SupabaseClient } from '@supabase/supabase-js';
import type { TaskAttachment } from './domain';

export const FILE_BUCKET = 'task-files';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_QUEUED_FILES = 5;
export const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';
const types: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
export function fileType(file: Pick<File, 'name' | 'type' | 'size'>) {
  const mime = types[file.name.split('.').pop()?.toLowerCase() || ''];
  if (!mime || (file.type && file.type !== mime))
    throw new Error('PDF, JPG, PNG, WebP 파일을 선택해 주세요.');
  if (file.size === 0) throw new Error('내용이 없는 파일은 첨부할 수 없어요.');
  if (file.size > MAX_FILE_BYTES) throw new Error('파일 하나의 크기는 10MB까지 올릴 수 있어요.');
  if (file.name.length > 255) throw new Error('파일 이름은 255자 이내로 줄여 주세요.');
  return mime;
}
export async function validateFile(file: File) {
  const mime = fileType(file),
    bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const starts = (...prefix: number[]) => prefix.every((n, i) => bytes[i] === n);
  const valid =
    mime === 'application/pdf'
      ? starts(37, 80, 68, 70, 45)
      : mime === 'image/jpeg'
        ? starts(255, 216, 255)
        : mime === 'image/png'
          ? starts(137, 80, 78, 71, 13, 10, 26, 10)
          : starts(82, 73, 70, 70) && [87, 69, 66, 80].every((n, i) => bytes[i + 8] === n);
  if (!valid)
    throw new Error(
      `“${file.name}”의 파일 형식을 확인해 주세요. 확장자만 바꾼 파일은 첨부할 수 없어요.`,
    );
  return mime;
}
export const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))}KB`
    : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
export async function removeBinaries(client: SupabaseClient, files: TaskAttachment[]) {
  if (!files.length) return;
  const { error } = await client.storage.from(FILE_BUCKET).remove(files.map((f) => f.object_path));
  if (error) throw new Error(`파일을 삭제하지 못했어요. 다시 시도해 주세요. ${error.message}`);
}
export async function removeFileRecords(
  client: SupabaseClient,
  files: TaskAttachment[],
  space: string,
) {
  if (!files.length) return;
  await removeBinaries(client, files);
  const result = await client
    .from('task_attachments')
    .delete()
    .eq('workspace_id', space)
    .in(
      'id',
      files.map((file) => file.id),
    )
    .select('id');
  if (result.error)
    throw new Error(`파일 삭제를 마무리하지 못했어요. 다시 시도해 주세요. ${result.error.message}`);
}
