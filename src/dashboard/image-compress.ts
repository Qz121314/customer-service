export type PreparedChatImage = {
  blob: Blob;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  originalName: string;
  previewUrl: string;
};

const MAX_EDGE = 1600;
const TARGET_BYTES = 400 * 1024;
const MAX_STATIC_BYTES = 1024 * 1024;
const MAX_GIF_BYTES = 5 * 1024 * 1024;
const QUALITIES = [0.78, 0.7, 0.62, 0.54, 0.46];

export async function prepareChatImage(file: File): Promise<PreparedChatImage> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.type === 'image/gif') return prepareGif(file);

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    if (Math.max(width, height) > MAX_EDGE) {
      const scale = MAX_EDGE / Math.max(width, height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    let blob = await encodeWebp(bitmap, width, height, QUALITIES[0]);
    for (const quality of QUALITIES.slice(1)) {
      if (blob.size <= TARGET_BYTES) break;
      blob = await encodeWebp(bitmap, width, height, quality);
    }
    let shrinkCount = 0;
    while (blob.size > TARGET_BYTES && Math.max(width, height) > 960 && shrinkCount < 4) {
      width = Math.max(1, Math.round(width * 0.85));
      height = Math.max(1, Math.round(height * 0.85));
      blob = await encodeWebp(bitmap, width, height, 0.58);
      shrinkCount += 1;
    }
    if (blob.size > MAX_STATIC_BYTES) throw new Error('图片压缩后仍超过 1MB');
    return {
      blob,
      mimeType: 'image/webp',
      byteSize: blob.size,
      width,
      height,
      originalName: replaceExtension(file.name || 'image', 'webp'),
      previewUrl: URL.createObjectURL(blob),
    };
  } finally {
    bitmap.close();
  }
}

export function releasePreparedImage(image: PreparedChatImage | null) {
  if (image) URL.revokeObjectURL(image.previewUrl);
}

async function prepareGif(file: File): Promise<PreparedChatImage> {
  if (file.size > MAX_GIF_BYTES) throw new Error('GIF 最大 5MB');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return {
      blob: file,
      mimeType: 'image/gif',
      byteSize: file.size,
      width: bitmap.width,
      height: bitmap.height,
      originalName: file.name || 'image.gif',
      previewUrl: URL.createObjectURL(file),
    };
  } finally {
    bitmap.close();
  }
}

async function encodeWebp(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('当前浏览器无法处理图片');
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))),
      'image/webp',
      quality,
    );
  });
}

function replaceExtension(name: string, extension: string) {
  const base = name.replace(/\.[^.]+$/u, '') || 'image';
  return `${base}.${extension}`;
}
