const SITE_LOGO_MAX_BYTES = 512 * 1024;
const SITE_LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const SITE_LOGO_PATH = '/client/v1/site-logo';
export const SITE_LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';
export const SITE_LOGO_MAX_LABEL = '512 KB';

export async function uploadSiteLogo(file: File): Promise<string> {
  validateSiteLogo(file);
  const response = await fetch('/api/admin/site-logo', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok) throw new Error(await responseError(response));
  return crypto.randomUUID();
}

export async function removeSiteLogo(): Promise<string> {
  const response = await fetch('/api/admin/site-logo', {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(await responseError(response));
  return crypto.randomUUID();
}

export function siteLogoUrl(revision = ''): string {
  return revision
    ? `${SITE_LOGO_PATH}?v=${encodeURIComponent(revision)}`
    : SITE_LOGO_PATH;
}

function validateSiteLogo(file: File) {
  if (!SITE_LOGO_TYPES.has(file.type)) {
    throw new Error('仅支持 PNG、JPG 或 WebP 图片。');
  }
  if (file.size <= 0 || file.size > SITE_LOGO_MAX_BYTES) {
    throw new Error(`Logo 文件需小于或等于 ${SITE_LOGO_MAX_LABEL}。`);
  }
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error === 'SITE_LOGO_TOO_LARGE') {
      return `Logo 文件需小于或等于 ${SITE_LOGO_MAX_LABEL}。`;
    }
    if (payload.error === 'INVALID_SITE_LOGO') {
      return 'Logo 图片格式无效，请使用 PNG、JPG 或 WebP。';
    }
    return payload.error ?? `HTTP_${response.status}`;
  } catch {
    return `HTTP_${response.status}`;
  }
}
