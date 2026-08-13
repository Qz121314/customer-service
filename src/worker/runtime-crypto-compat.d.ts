// Cloudflare Workers accepts Web Crypto algorithm dictionaries whose typed-array
// views may be backed by ArrayBufferLike. TypeScript 5.9 narrows the built-in
// overloads more than the runtime, so keep a Worker-compatible dictionary overload.
interface SubtleCrypto {
  deriveBits(
    algorithm: AlgorithmIdentifier | { name: string; [key: string]: unknown },
    baseKey: CryptoKey,
    length?: number | null,
  ): Promise<ArrayBuffer>;
}
