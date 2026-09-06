export type VisitorPromotionSettings = {
  id: string | null;
  isEnabled: boolean;
  title: string;
  summary: string;
  coverUrl: string | null;
  bodyMarkdown: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type VisitorPromotionInput = Pick<
  VisitorPromotionSettings,
  | 'isEnabled'
  | 'title'
  | 'summary'
  | 'coverUrl'
  | 'bodyMarkdown'
  | 'ctaLabel'
  | 'ctaUrl'
  | 'startsAt'
  | 'endsAt'
>;

export async function getVisitorPromotion(): Promise<VisitorPromotionSettings | null> {
  const response = await promotionRequest<{
    promotion: VisitorPromotionSettings | null;
  }>('/api/admin/visitor-promotion');
  return response.promotion;
}

export async function updateVisitorPromotion(
  input: VisitorPromotionInput,
): Promise<VisitorPromotionSettings> {
  const response = await promotionRequest<{
    promotion: VisitorPromotionSettings;
  }>('/api/admin/visitor-promotion', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return response.promotion;
}

async function promotionRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const value = (await response.json().catch(() => null)) as
    ({ error?: string } & Partial<T>) | null;
  if (!response.ok) {
    throw new Error(promotionError(value?.error));
  }
  return value as T;
}

function promotionError(code?: string): string {
  if (code === 'UNAUTHORIZED') return '登录已失效，请重新登录';
  if (code === 'INVALID_PROMOTION')
    return '标题、摘要和文章内容不能为空或超出长度限制';
  if (code === 'INVALID_PROMOTION_URL') return '封面地址必须使用 http 或 https';
  if (code === 'INVALID_PROMOTION_CTA')
    return 'CTA 文案和地址必须同时填写，地址需使用 http 或 https';
  if (code === 'INVALID_PROMOTION_TIME') return '推广起止时间无效';
  return code ?? '保存访客推广失败';
}
