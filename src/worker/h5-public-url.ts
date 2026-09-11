export function normalizePublicOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    if (url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildH5PublicUrl(
  publicOrigin: string | null,
  slug: string,
): string | null {
  const origin = normalizePublicOrigin(publicOrigin);
  if (!origin || !slug) return null;
  return `${origin}/${slug}/`;
}

export function normalizeH5Slug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u.test(slug)) {
    return null;
  }
  return slug;
}

export function normalizeH5Text(
  value: unknown,
  maxLength = 200,
): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

export function normalizeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
    if (url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}
