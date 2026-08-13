export const CURRENT_AGENT_PASSWORD_ITERATIONS = 10_000;

export async function hashAgentPassword(
  password: string,
  iterations = CURRENT_AGENT_PASSWORD_ITERATIONS,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  return {
    hash: await derivePassword(password, saltBytes, iterations),
    salt: toHex(saltBytes),
    iterations,
  };
}

export async function verifyAgentPassword(
  password: string,
  expectedHash: string,
  saltHex: string,
  iterations: number,
): Promise<boolean> {
  const salt = fromHex(saltHex);
  if (!salt.length || !Number.isInteger(iterations) || iterations < 1_000) {
    return false;
  }
  const actual = await derivePassword(password, salt, iterations);
  return timingSafeEqual(actual, expectedHash);
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new Uint8Array(salt).buffer,
      iterations,
    },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function fromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/iu.test(value) || value.length % 2 !== 0) {
    return new Uint8Array();
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}
