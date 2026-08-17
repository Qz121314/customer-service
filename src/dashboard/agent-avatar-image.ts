export type PreparedAgentAvatar = {
  blob: Blob;
  mimeType: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  byteSize: number;
};

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_AVATAR_EDGE = 512;
const TARGET_BYTES = 220 * 1024;
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function prepareAgentAvatar(file: File): Promise<PreparedAgentAvatar> {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error('请选择 JPG、PNG 或 WebP 图片');
  }
  if (!file.size || file.size > MAX_SOURCE_BYTES) {
    throw new Error('原图不能超过 15 MB');
  }

  const source = await decodeImage(file);
  try {
    const cropSize = Math.min(source.width, source.height);
    const outputSize = Math.max(1, Math.min(MAX_AVATAR_EDGE, cropSize));
    const sourceX = Math.max(0, Math.floor((source.width - cropSize) / 2));
    const sourceY = Math.max(0, Math.floor((source.height - cropSize) / 2));
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('当前浏览器无法处理头像图片');

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, outputSize, outputSize);
    context.drawImage(
      source.image,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      outputSize,
      outputSize,
    );

    const webp = await compressCanvas(canvas, 'image/webp');
    if (webp) {
      return {
        blob: webp,
        mimeType: 'image/webp',
        width: outputSize,
        height: outputSize,
        byteSize: webp.size,
      };
    }

    const jpeg = await compressCanvas(canvas, 'image/jpeg');
    if (!jpeg) throw new Error('头像压缩失败，请换一张图片重试');
    return {
      blob: jpeg,
      mimeType: 'image/jpeg',
      width: outputSize,
      height: outputSize,
      byteSize: jpeg.size,
    };
  } finally {
    source.close();
  }
}

async function compressCanvas(
  canvas: HTMLCanvasElement,
  mimeType: 'image/webp' | 'image/jpeg',
): Promise<Blob | null> {
  const qualities = [0.84, 0.78, 0.72, 0.66, 0.6];
  let smallest: Blob | null = null;
  for (const quality of qualities) {
    const blob = await canvasBlob(canvas, mimeType, quality);
    if (!blob) return null;
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= TARGET_BYTES) return blob;
  }
  return smallest && smallest.size <= 320 * 1024 ? smallest : null;
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

type DecodedImage = {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decodeImage(file: File): Promise<DecodedImage> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.decoding = 'async';
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('图片无法读取，请换一张重试'));
      element.src = objectUrl;
    });
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}
