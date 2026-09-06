export type VisitorPromotionSettings = {
  id: string;
  revision: number;
  isEnabled: boolean;
  title: string;
  summary: string;
  coverUrl: string | null;
  bodyMarkdown: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
};

export type VisitorPromotionDraft = Omit<
  VisitorPromotionSettings,
  'id' | 'revision' | 'updatedAt'
>;

type PromotionEnvelope = { promotion: VisitorPromotionSettings | null };

export async function getVisitorPromotion(): Promise<VisitorPromotionSettings | null> {
  return (await promotionRequest<PromotionEnvelope>('/api/admin/visitor-promotion'))
    .promotion;
}

export async function updateVisitorPromotion(
  promotion: VisitorPromotionDraft,
): Promise<VisitorPromotionSettings> {
  const response = await promotionRequest<PromotionEnvelope>(
    '/api/admin/visitor-promotion',
    {
      method: 'PUT',
      body: JSON.stringify(promotion),
    },
  );
  if (!response.promotion) throw new Error('PROMOTION_SAVE_FAILED');
  return response.promotion;
}

async function promotionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  const value = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;
  if (!response.ok) {
    const code = value && 'error' in value ? value.error : null;
    throw new Error(code || 'PROMOTION_REQUEST_FAILED');
  }
  return value as T;
}
