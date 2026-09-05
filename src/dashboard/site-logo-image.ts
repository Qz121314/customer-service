export const SITE_LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';
export const SITE_LOGO_INPUT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
export const SITE_LOGO_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const SITE_LOGO_MAX_UPLOAD_BYTES = 1024 * 1024;
export const SITE_LOGO_MAX_EDGE = 512;
export const SITE_LOGO_WEBP_QUALITY = 0.86;

export type PreparedSiteLogo = {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
  contentType: string;
};

export function fitSiteLogoDimensions(
  width: number,
  height: number,
  maxEdge = SITE_LOGO_MAX_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('无法读取站点 Logo 尺寸。');
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function shouldKeepOriginalSiteLogo({
  originalBytes,
  originalWidth,
  originalHeight,
  convertedBytes,
}: {
  originalBytes: number;
  originalWidth: number;
  originalHeight: number;
  convertedBytes: number;
}): boolean {
  return (
    originalBytes <= SITE_LOGO_MAX_UPLOAD_BYTES &&
    originalWidth <= SITE_LOGO_MAX_EDGE &&
    originalHeight <= SITE_LOGO_MAX_EDGE &&
    originalBytes <= convertedBytes
  );
}

export async function prepareSiteLogo(file: File): Promise<PreparedSiteLogo> {
  if (!SITE_LOGO_INPUT_TYPES.has(file.type)) {
    throw new Error('站点 Logo 仅支持 PNG、JPG 或 WebP。');
  }
  if (file.size === 0) throw new Error('站点 Logo 文件为空。');
  if (file.size > SITE_LOGO_MAX_INPUT_BYTES) {
    throw new Error('原始站点 Logo 不能超过 5 MB。');
  }

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('无法解码站点 Logo，请重新选择图片。');
  }

  try {
    const target = fitSiteLogoDimensions(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('当前浏览器无法处理站点 Logo。');
    context.drawImage(image, 0, 0, target.width, target.height);

    const converted = await canvasToBlob(
      canvas,
      'image/webp',
      SITE_LOGO_WEBP_QUALITY,
    );
    const keepOriginal = shouldKeepOriginalSiteLogo({
      originalBytes: file.size,
      originalWidth: image.width,
      originalHeight: image.height,
      convertedBytes: converted.size,
    });
    const blob = keepOriginal ? file : converted;
    if (blob.size > SITE_LOGO_MAX_UPLOAD_BYTES) {
      throw new Error('处理后的站点 Logo 仍超过 1 MB，请选择更小的图片。');
    }

    return {
      blob,
      width: keepOriginal ? image.width : target.width,
      height: keepOriginal ? image.height : target.height,
      originalBytes: file.size,
      contentType: blob.type || file.type,
    };
  } finally {
    image.close();
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('当前浏览器无法压缩站点 Logo。'));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}
