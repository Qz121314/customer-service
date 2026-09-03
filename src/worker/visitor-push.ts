type VisitorPushBindings = {
  DB: D1Database;
};

export type VapidRow = {
  public_key: string;
  private_jwk: string;
  subject: string;
};

type VisitorPushRow = VapidRow & {
  endpoint: string;
};

type PushDeliveryOptions = {
  ttlSeconds?: number;
  topic?: string;
};

export type VapidSigningContext = {
  publicKey: string;
  subject: string;
  privateKey: CryptoKey;
  header: string;
  expiresAt: number;
  tokensByOrigin: Map<string, Promise<string>>;
};

const VAPID_ID = 'default';
const VAPID_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const PUSH_TTL_SECONDS = 60;

export async function getVisitorPushPublicKey(
  db: D1Database,
  requestOrigin: string,
): Promise<string> {
  const config = await getOrCreateVapidConfig(db, requestOrigin);
  return config.public_key;
}

export async function sendVisitorPushForConversation(
  env: VisitorPushBindings,
  conversationId: string,
): Promise<void> {
  const subscriptions = await env.DB.prepare(
    `SELECT
       subscription.endpoint,
       vapid.public_key,
       vapid.private_jwk,
       vapid.subject
     FROM conversations conversation
     JOIN visitors visitor
       ON visitor.id = conversation.visitor_id
     JOIN visitor_push_subscriptions subscription
       ON subscription.site_id = conversation.site_id
      AND subscription.visitor_external_id = visitor.external_id
     JOIN visitor_push_vapid vapid
       ON vapid.id = 'default'
     WHERE conversation.id = ?1
       AND visitor.external_id IS NOT NULL
       AND (
         subscription.expiration_time IS NULL
         OR subscription.expiration_time > ?2
       )
       AND COALESCE(
         conversation.expires_at,
         datetime(conversation.created_at, '+1 day')
       ) > CURRENT_TIMESTAMP`,
  )
    .bind(conversationId, Date.now())
    .all<VisitorPushRow>();
  if (!subscriptions.results?.length) return;

  const staleEndpoints = new Set<string>();
  const signingContext = await createVapidSigningContext(
    subscriptions.results[0],
  );
  const deliveryResults = await Promise.all(
    subscriptions.results.map(async (subscription) => ({
      endpoint: subscription.endpoint,
      gone: await deliverVisitorPush(subscription.endpoint, signingContext),
    })),
  );
  for (const result of deliveryResults) {
    if (result.gone) staleEndpoints.add(result.endpoint);
  }

  if (staleEndpoints.size > 0) {
    await deleteVisitorPushSubscriptions(env.DB, [...staleEndpoints]);
  }
}

async function deliverVisitorPush(
  endpoint: string,
  signingContext: VapidSigningContext,
): Promise<boolean> {
  try {
    const response = await sendDataLessPush(endpoint, signingContext);
    if (response.status === 404 || response.status === 410) return true;
    if (!response.ok) {
      console.warn('Visitor push delivery failed.', response.status);
    }
  } catch (error) {
    console.warn('Visitor push delivery failed.', error);
  }
  return false;
}

async function deleteVisitorPushSubscriptions(
  db: D1Database,
  endpoints: string[],
): Promise<void> {
  if (endpoints.length === 0) return;
  await db
    .prepare(
      `DELETE FROM visitor_push_subscriptions
       WHERE endpoint IN (
         SELECT CAST(value AS TEXT) FROM json_each(?1)
       )`,
    )
    .bind(JSON.stringify(endpoints))
    .run();
}

async function getOrCreateVapidConfig(
  db: D1Database,
  requestOrigin: string,
): Promise<VapidRow> {
  const existing = await readVapidConfig(db);
  if (existing) return existing;

  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const publicKey = base64UrlEncode(
    new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const subject = vapidSubject(requestOrigin);

  await db
    .prepare(
      `INSERT OR IGNORE INTO visitor_push_vapid
       (id, public_key, private_jwk, subject, updated_at)
       VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)`,
    )
    .bind(VAPID_ID, publicKey, JSON.stringify(privateJwk), subject)
    .run();

  const saved = await readVapidConfig(db);
  if (!saved) throw new Error('VAPID configuration persistence failed.');
  return saved;
}

export async function readVapidConfig(
  db: D1Database,
): Promise<VapidRow | null> {
  return db
    .prepare(
      `SELECT public_key, private_jwk, subject
       FROM visitor_push_vapid WHERE id = ?1 LIMIT 1`,
    )
    .bind(VAPID_ID)
    .first<VapidRow>();
}

export async function sendDataLessPush(
  endpoint: string,
  signingContext: VapidSigningContext,
  options: PushDeliveryOptions = {},
): Promise<Response> {
  const endpointUrl = new URL(endpoint);
  let tokenPromise = signingContext.tokensByOrigin.get(endpointUrl.origin);
  if (!tokenPromise) {
    tokenPromise = signVapidToken(signingContext, endpointUrl.origin);
    signingContext.tokensByOrigin.set(endpointUrl.origin, tokenPromise);
  }
  const token = await tokenPromise;
  const headers: Record<string, string> = {
    Authorization: `vapid t=${token}, k=${signingContext.publicKey}`,
    TTL: String(options.ttlSeconds ?? PUSH_TTL_SECONDS),
    Urgency: 'high',
  };
  if (options.topic) headers.Topic = options.topic;

  return fetch(endpointUrl, {
    method: 'POST',
    headers,
  });
}

export async function createVapidSigningContext(
  config: VapidRow,
): Promise<VapidSigningContext> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(config.private_jwk) as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return {
    publicKey: config.public_key,
    subject: config.subject,
    privateKey,
    header: base64UrlJson({ typ: 'JWT', alg: 'ES256' }),
    expiresAt: Math.floor(Date.now() / 1000) + VAPID_TOKEN_TTL_SECONDS,
    tokensByOrigin: new Map(),
  };
}

async function signVapidToken(
  context: VapidSigningContext,
  origin: string,
): Promise<string> {
  const payload = base64UrlJson({
    aud: origin,
    exp: context.expiresAt,
    sub: context.subject,
  });
  const unsignedToken = `${context.header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    context.privateKey,
    new TextEncoder().encode(unsignedToken),
  );
  return `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function vapidSubject(requestOrigin: string): string {
  try {
    const url = new URL(requestOrigin);
    if (url.protocol === 'https:') return url.origin;
  } catch {
    // Local development falls through to a syntactically valid contact URI.
  }
  return 'https://customer-service.invalid';
}

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}
