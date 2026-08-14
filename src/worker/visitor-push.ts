type VisitorPushBindings = {
  DB: D1Database;
};

type VapidRow = {
  public_key: string;
  private_jwk: string;
  subject: string;
};

type SubscriptionRow = {
  endpoint: string;
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
  const identity = await env.DB.prepare(
    `SELECT c.site_id, v.external_id
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     WHERE c.id = ?1
     LIMIT 1`,
  )
    .bind(conversationId)
    .first<{ site_id: string; external_id: string | null }>();
  if (!identity?.external_id) return;

  const config = await readVapidConfig(env.DB);
  if (!config) return;

  const now = Date.now();
  await env.DB.prepare(
    `DELETE FROM visitor_push_subscriptions
     WHERE expiration_time IS NOT NULL AND expiration_time <= ?1`,
  )
    .bind(now)
    .run();

  const subscriptions = await env.DB.prepare(
    `SELECT endpoint
     FROM visitor_push_subscriptions
     WHERE site_id = ?1 AND visitor_external_id = ?2`,
  )
    .bind(identity.site_id, identity.external_id)
    .all<SubscriptionRow>();
  if (!subscriptions.results?.length) return;

  await Promise.all(
    subscriptions.results.map(async ({ endpoint }) => {
      try {
        const response = await sendDataLessPush(endpoint, config);
        if (response.status === 404 || response.status === 410) {
          await env.DB.prepare(
            'DELETE FROM visitor_push_subscriptions WHERE endpoint = ?1',
          )
            .bind(endpoint)
            .run();
          return;
        }
        if (!response.ok) {
          console.warn('Visitor push delivery failed.', response.status);
        }
      } catch (error) {
        console.warn('Visitor push delivery failed.', error);
      }
    }),
  );
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

async function readVapidConfig(db: D1Database): Promise<VapidRow | null> {
  return db
    .prepare(
      `SELECT public_key, private_jwk, subject
       FROM visitor_push_vapid WHERE id = ?1 LIMIT 1`,
    )
    .bind(VAPID_ID)
    .first<VapidRow>();
}

async function sendDataLessPush(
  endpoint: string,
  config: VapidRow,
): Promise<Response> {
  const endpointUrl = new URL(endpoint);
  const header = base64UrlJson({ typ: 'JWT', alg: 'ES256' });
  const payload = base64UrlJson({
    aud: endpointUrl.origin,
    exp: Math.floor(Date.now() / 1000) + VAPID_TOKEN_TTL_SECONDS,
    sub: config.subject,
  });
  const unsignedToken = `${header}.${payload}`;
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(config.private_jwk) as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(unsignedToken),
  );
  const token = `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;

  return fetch(endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${token}, k=${config.public_key}`,
      TTL: String(PUSH_TTL_SECONDS),
      Urgency: 'high',
    },
  });
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
