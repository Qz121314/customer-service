import type { PreparedChatImage } from './image-compress';

export type UploadTarget = {
  mode: 'direct' | 'proxy';
  url: string;
  headers: Record<string, string>;
};

export function uploadPreparedImage(
  target: UploadTarget,
  image: PreparedChatImage,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.url, true);
    for (const [name, value] of Object.entries(target.headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(1, event.loaded / event.total));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new Error(`图片上传失败（${xhr.status}）`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('图片上传失败')));
    xhr.addEventListener('abort', () => reject(new Error('图片上传已取消')));
    xhr.send(image.blob);
  });
}
