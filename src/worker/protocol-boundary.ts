const REMOVED_PROTOCOL_PREFIXES = [
  '/api/public',
  '/management/v1',
  '/api/admin/conversations',
  '/api/admin/realtime',
] as const;

const REMOVED_AGENT_TRANSFER_PATH =
  /^\/api\/agent\/conversations\/[^/]+\/transfer$/u;

export function isRemovedProtocolPath(pathname: string): boolean {
  if (REMOVED_AGENT_TRANSFER_PATH.test(pathname)) return true;
  return REMOVED_PROTOCOL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function removedProtocolResponse(): Response {
  return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
}
