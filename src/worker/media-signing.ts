type DirectUploadEnv = {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
};

export type UploadTarget = {
  mode: 'direct' | 'proxy';
  url: string;
  headers: Record<string, string>;
};

const DEFAULT_BUCKET = 'customer-service-media';
const PRESIGNED_TTL_SECONDS = 300;

export type DownloadSigningContext = {
  accessKeyId: string;
  host: string;
  bucket: string;
  expiresAt: number;
  signingKey: ArrayBuffer;
  amzDate: string;
  scope: string;
};

export async function createUploadTarget(
  env: DirectUploadEnv,
  proxyUrl: string,
  objectKey: string,
  mimeType: string,
): Promise<UploadTarget> {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    return {
      mode: 'proxy',
      url: proxyUrl,
      headers: { 'Content-Type': mimeType },
    };
  }

  const bucket = env.R2_BUCKET_NAME?.trim() || DEFAULT_BUCKET;
  return {
    mode: 'direct',
    url: await presignPut({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      objectKey,
      mimeType,
      expiresIn: PRESIGNED_TTL_SECONDS,
    }),
    headers: { 'Content-Type': mimeType },
  };
}

type PresignInput = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  objectKey: string;
  mimeType: string;
  expiresIn: number;
};

export async function createDownloadSigningContext(
  env: DirectUploadEnv,
  expiresAt: string | null,
): Promise<DownloadSigningContext | null> {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  const now = new Date();
  const boundedExpiry = Math.min(
    Date.parse(expiresAt ?? '') || now.getTime() + PRESIGNED_TTL_SECONDS * 1000,
    now.getTime() + PRESIGNED_TTL_SECONDS * 1000,
  );
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/gu, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  return {
    accessKeyId,
    host: `${accountId}.r2.cloudflarestorage.com`,
    bucket: env.R2_BUCKET_NAME?.trim() || DEFAULT_BUCKET,
    expiresAt: boundedExpiry,
    signingKey: await signatureKey(secretAccessKey, dateStamp, region, service),
    amzDate,
    scope: `${dateStamp}/${region}/${service}/aws4_request`,
  };
}

export async function presignGet(
  context: DownloadSigningContext,
  objectKey: string,
): Promise<string> {
  const expiresIn = Math.max(
    1,
    Math.min(
      PRESIGNED_TTL_SECONDS,
      Math.ceil((context.expiresAt - Date.now()) / 1000),
    ),
  );
  const canonicalUri = `/${awsEncode(context.bucket)}/${objectKey
    .split('/')
    .map(awsEncode)
    .join('/')}`;
  const query = new Map<string, string>([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${context.accessKeyId}/${context.scope}`],
    ['X-Amz-Date', context.amzDate],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);
  const canonicalQuery = [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join('&');
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${context.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    context.amzDate,
    context.scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = toHex(await hmac(context.signingKey, stringToSign));
  return `https://${context.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function presignPut(input: PresignInput): Promise<string> {
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/gu, '')
    .replace('Z', 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const host = `${input.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${awsEncode(input.bucket)}/${input.objectKey
    .split('/')
    .map(awsEncode)
    .join('/')}`;

  const query = new Map<string, string>([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresIn)],
    ['X-Amz-SignedHeaders', 'content-type;host'],
  ]);
  const canonicalQuery = [...query.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join('&');
  const canonicalHeaders = `content-type:${input.mimeType.trim()}\nhost:${host}\n`;
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'content-type;host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = await signatureKey(
    input.secretAccessKey,
    dateStamp,
    region,
    service,
  );
  const signature = toHex(await hmac(signingKey, stringToSign));
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function signatureKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(
    new TextEncoder().encode(`AWS4${secret}`),
    dateStamp,
  );
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

async function hmac(
  key: ArrayBuffer | Uint8Array,
  value: string,
): Promise<ArrayBuffer> {
  const rawKey = key instanceof Uint8Array ? new Uint8Array(key).buffer : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return toHex(digest);
}

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
