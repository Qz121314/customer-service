export type ContactCardIconMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp';

export type ContactCardIconRef = {
  objectKey: string;
  mimeType: ContactCardIconMimeType;
};

const CARD_ICON_PREFIX = 'contact-card-icon:v1:';
const MIME_TO_CODE: Record<ContactCardIconMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const CODE_TO_MIME: Record<string, ContactCardIconMimeType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export function encodeContactCardIconRef(ref: ContactCardIconRef): string {
  return `${CARD_ICON_PREFIX}${MIME_TO_CODE[ref.mimeType]}:${ref.objectKey}`;
}

export function decodeContactCardIconRef(
  value: unknown,
): ContactCardIconRef | null {
  if (typeof value !== 'string' || !value.startsWith(CARD_ICON_PREFIX)) {
    return null;
  }
  const encoded = value.slice(CARD_ICON_PREFIX.length);
  const separator = encoded.indexOf(':');
  if (separator < 1) return null;
  const mimeType = CODE_TO_MIME[encoded.slice(0, separator)];
  const objectKey = encoded.slice(separator + 1);
  if (
    !mimeType ||
    !objectKey.startsWith('agent-card-icons/') ||
    objectKey.length > 500
  ) {
    return null;
  }
  return { objectKey, mimeType };
}

export function hasContactCardIconRef(value: unknown): boolean {
  return decodeContactCardIconRef(value) !== null;
}
