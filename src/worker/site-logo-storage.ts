export const SITE_LOGO_POINTER_KEY = 'site-assets/default/logo/current.json';
export const SITE_LOGO_ASSET_PREFIX = 'site-assets/default/logo/assets/';
export const LEGACY_SITE_LOGO_KEY = 'site-branding/default/logo';

export type SiteLogoInfo = {
  assetId: string;
  url: string;
  contentType: string;
  byteSize: number;
  updatedAt: string;
};

type SiteLogoPointer = {
  assetId: string;
  key: string;
  contentType: string;
  byteSize: number;
  updatedAt: string;
};

type CurrentSiteLogo = SiteLogoPointer & { legacy: boolean };

export type SiteLogoMutationResult = {
  logo: SiteLogoInfo | null;
  cleanupWarning: boolean;
};

export async function getCurrentSiteLogo(
  bucket: R2Bucket,
): Promise<SiteLogoInfo | null> {
  const current = await readCurrentSiteLogo(bucket);
  return current ? publicInfo(current) : null;
}

export async function replaceSiteLogo(
  bucket: R2Bucket,
  bytes: Uint8Array,
  contentType: string,
): Promise<SiteLogoMutationResult> {
  const previous = await readCurrentSiteLogo(bucket);
  const assetId = crypto.randomUUID();
  const key = siteLogoAssetKey(assetId);
  const updatedAt = new Date().toISOString();
  const pointer: SiteLogoPointer = {
    assetId,
    key,
    contentType,
    byteSize: bytes.byteLength,
    updatedAt,
  };

  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: { owner: 'site-logo', siteId: 'default', assetId },
  });

  try {
    await bucket.put(SITE_LOGO_POINTER_KEY, JSON.stringify(pointer), {
      httpMetadata: {
        contentType: 'application/json',
        cacheControl: 'no-store',
      },
      customMetadata: { owner: 'site-logo-pointer', siteId: 'default' },
    });
  } catch (error) {
    const orphanRemoved = await deleteWithRetry(bucket, key);
    if (!orphanRemoved) {
      console.error('site-logo.persist-orphan-cleanup.failed', { key });
    }
    console.error('site-logo.persist.failed', error);
    throw new Error('SITE_LOGO_PERSIST_FAILED');
  }

  let cleanupWarning = false;
  if (previous?.key && previous.key !== key) {
    cleanupWarning = !(await deleteWithRetry(bucket, previous.key));
    if (cleanupWarning) {
      console.warn('site-logo.previous-object-cleanup.failed', {
        key: previous.key,
      });
    }
  }

  return { logo: publicInfo({ ...pointer, legacy: false }), cleanupWarning };
}

export async function removeSiteLogo(
  bucket: R2Bucket,
): Promise<SiteLogoMutationResult> {
  const previous = await readCurrentSiteLogo(bucket);
  if (!previous) return { logo: null, cleanupWarning: false };

  if (!previous.legacy) {
    await bucket.delete(SITE_LOGO_POINTER_KEY);
  }

  const cleanupWarning = !(await deleteWithRetry(bucket, previous.key));
  if (cleanupWarning) {
    console.warn('site-logo.removed-object-cleanup.failed', {
      key: previous.key,
    });
  }
  return { logo: null, cleanupWarning };
}

export function siteLogoAssetKey(assetId: string): string {
  if (!isSiteLogoAssetId(assetId)) throw new Error('INVALID_SITE_LOGO_ASSET');
  return `${SITE_LOGO_ASSET_PREFIX}${assetId}`;
}

export function siteLogoAssetUrl(assetId: string): string {
  if (assetId === 'legacy') return '/client/v1/site-logo';
  if (!isSiteLogoAssetId(assetId)) throw new Error('INVALID_SITE_LOGO_ASSET');
  return `/client/v1/site-logo/${encodeURIComponent(assetId)}`;
}

export function isSiteLogoAssetId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

export function isAllowedSiteLogoKey(key: string): boolean {
  if (key === LEGACY_SITE_LOGO_KEY) return true;
  if (!key.startsWith(SITE_LOGO_ASSET_PREFIX)) return false;
  return isSiteLogoAssetId(key.slice(SITE_LOGO_ASSET_PREFIX.length));
}

async function readCurrentSiteLogo(
  bucket: R2Bucket,
): Promise<CurrentSiteLogo | null> {
  const pointerObject = await bucket.get(SITE_LOGO_POINTER_KEY);
  if (pointerObject) {
    let parsed: SiteLogoPointer;
    try {
      parsed = JSON.parse(await pointerObject.text()) as SiteLogoPointer;
    } catch {
      throw new Error('SITE_LOGO_POINTER_INVALID');
    }
    if (
      !isSiteLogoAssetId(parsed.assetId) ||
      parsed.key !== siteLogoAssetKey(parsed.assetId) ||
      !isAllowedSiteLogoKey(parsed.key) ||
      !isSupportedContentType(parsed.contentType) ||
      !Number.isFinite(parsed.byteSize) ||
      parsed.byteSize <= 0 ||
      !parsed.updatedAt
    ) {
      throw new Error('SITE_LOGO_POINTER_INVALID');
    }
    return { ...parsed, legacy: false };
  }

  const legacy = await bucket.get(LEGACY_SITE_LOGO_KEY);
  if (!legacy) return null;
  return {
    assetId: 'legacy',
    key: LEGACY_SITE_LOGO_KEY,
    contentType: legacy.httpMetadata?.contentType ?? 'image/webp',
    byteSize: legacy.size,
    updatedAt: legacy.uploaded.toISOString(),
    legacy: true,
  };
}

function publicInfo(current: CurrentSiteLogo): SiteLogoInfo {
  return {
    assetId: current.assetId,
    url: siteLogoAssetUrl(current.assetId),
    contentType: current.contentType,
    byteSize: current.byteSize,
    updatedAt: current.updatedAt,
  };
}

function isSupportedContentType(contentType: string): boolean {
  return (
    contentType === 'image/webp' ||
    contentType === 'image/png' ||
    contentType === 'image/jpeg'
  );
}

async function deleteWithRetry(bucket: R2Bucket, key: string): Promise<boolean> {
  if (!isAllowedSiteLogoKey(key)) return false;
  try {
    await bucket.delete(key);
    return true;
  } catch {
    try {
      await bucket.delete(key);
      return true;
    } catch {
      return false;
    }
  }
}
