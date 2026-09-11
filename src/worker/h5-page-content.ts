export const H5_HTML_MAX_BYTES = 5 * 1024 * 1024;
export const H5_PAGE_CONTENT_PREFIX = 'h5-pages/';

export type H5HtmlValidation =
  | { ok: true; html: string; bytes: Uint8Array }
  | { ok: false; code: 'INVALID_H5_HTML' | 'H5_HTML_TOO_LARGE' };

export type H5PageContentRow = {
  site_id: string;
  page_id: string;
  draft_asset_id: string | null;
  draft_byte_size: number | null;
  draft_uploaded_at: string | null;
  published_asset_id: string | null;
  published_byte_size: number | null;
  published_at: string | null;
};

export function h5PageAssetKey(
  siteId: string,
  pageId: string,
  assetId: string,
): string {
  return `${H5_PAGE_CONTENT_PREFIX}${siteId}/${pageId}/versions/${assetId}.html`;
}

export function validateH5Html(
  contentType: string | null,
  bytes: Uint8Array,
): H5HtmlValidation {
  if (bytes.byteLength === 0) {
    return { ok: false, code: 'INVALID_H5_HTML' };
  }
  if (bytes.byteLength > H5_HTML_MAX_BYTES) {
    return { ok: false, code: 'H5_HTML_TOO_LARGE' };
  }
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'text/html') {
    return { ok: false, code: 'INVALID_H5_HTML' };
  }

  let html: string;
  try {
    html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: 'INVALID_H5_HTML' };
  }

  if (!html.trim() || !/<(?:!doctype\s+html|[a-z][^>]*>)/iu.test(html)) {
    return { ok: false, code: 'INVALID_H5_HTML' };
  }
  if (/<script\b[^>]*\bsrc\s*=/iu.test(html)) {
    return { ok: false, code: 'INVALID_H5_HTML' };
  }
  if (
    /connect\.facebook\.net|fbevents\.js|\bfbq\s*\(|facebook\s*pixel|meta\s+sdk|google-analytics|\bgtag\s*\(|segment\.com|mixpanel|hotjar|clarity\.ms|posthog/iu.test(
      html,
    )
  ) {
    return { ok: false, code: 'INVALID_H5_HTML' };
  }
  return { ok: true, html, bytes };
}

export function h5ContentStatus(
  content: Pick<
    H5PageContentRow,
    'draft_asset_id' | 'published_asset_id'
  > | null,
): 'unuploaded' | 'pending' | 'published' | 'updated' {
  if (!content?.draft_asset_id && !content?.published_asset_id) {
    return 'unuploaded';
  }
  if (!content.published_asset_id) return 'pending';
  return content.draft_asset_id === content.published_asset_id
    ? 'published'
    : 'updated';
}
