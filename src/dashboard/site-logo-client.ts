export type SiteLogoInfo = {
  assetId: string;
  url: string;
  contentType: string;
  byteSize: number;
  updatedAt: string;
};

export type SiteLogoMutationResult = {
  siteLogo: SiteLogoInfo | null;
  cleanupWarning: boolean;
};

export async function getSiteLogo(): Promise<SiteLogoInfo | null> {
  const response = await fetch('/api/admin/site-logo', {
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = (await response.json()) as { siteLogo?: SiteLogoInfo | null };
  return payload.siteLogo ?? null;
}

export function uploadSiteLogo(
  blob: Blob,
  onTransferComplete?: () => void,
): Promise<SiteLogoMutationResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', '/api/admin/site-logo');
    request.responseType = 'json';
    request.withCredentials = true;
    request.setRequestHeader('Content-Type', blob.type);
    request.upload.addEventListener('load', () => onTransferComplete?.(), {
      once: true,
    });
    request.addEventListener('load', () => {
      const payload = request.response as
        | (SiteLogoMutationResult & { error?: string })
        | null;
      if (request.status >= 200 && request.status < 300 && payload) {
        resolve({
          siteLogo: payload.siteLogo ?? null,
          cleanupWarning: Boolean(payload.cleanupWarning),
        });
        return;
      }
      reject(new Error(clientError(payload?.error, request.status)));
    });
    request.addEventListener('error', () => {
      reject(new Error('上传站点 Logo 失败，请检查网络后重试。'));
    });
    request.send(blob);
  });
}

export async function removeSiteLogo(): Promise<SiteLogoMutationResult> {
  const response = await fetch('/api/admin/site-logo', {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = (await response.json()) as SiteLogoMutationResult;
  return {
    siteLogo: payload.siteLogo ?? null,
    cleanupWarning: Boolean(payload.cleanupWarning),
  };
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return clientError(payload.error, response.status);
  } catch {
    return `HTTP_${response.status}`;
  }
}

function clientError(error: string | undefined, status: number): string {
  if (error === 'SITE_LOGO_TOO_LARGE') {
    return '处理后的 Logo 不能超过 1 MB。';
  }
  if (error === 'INVALID_SITE_LOGO') {
    return 'Logo 图片格式无效，请使用 PNG、JPG 或 WebP。';
  }
  if (error === 'SITE_LOGO_SAVE_FAILED') {
    return '站点 Logo 保存失败，原 Logo 已保留。';
  }
  if (error === 'SITE_LOGO_REMOVE_FAILED') {
    return '站点 Logo 移除失败，请稍后重试。';
  }
  if (error === 'SITE_LOGO_READ_FAILED') {
    return '站点 Logo 状态读取失败。';
  }
  return error ?? `HTTP_${status}`;
}
