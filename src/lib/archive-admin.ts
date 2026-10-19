import { adminRequest } from '@/lib/admin-api';

export function archiveRequest<T>(url: string, options: RequestInit = {}) {
  return adminRequest<T>(url, { ...options, cache: 'no-store' });
}

/** Fetch before download so a JSON error never replaces the editor page. */
export async function downloadArchiveVersion(archiveId: string, versionId: string) {
  const query = new URLSearchParams({ versionId });
  const response = await fetch('/api/admin/archives/' + encodeURIComponent(archiveId) + '/export?' + query, { cache: 'no-store' });
  if (response.status === 401) { window.location.assign('/admin/login'); throw new Error('登录已过期'); }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || '导出失败，请稍后重试');
  }
  if (!response.headers.get('Content-Type')?.startsWith('text/markdown')) { throw new Error('导出响应格式不正确'); }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'archive-' + archiveId + '-' + versionId + '.md';
  document.documentElement.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
