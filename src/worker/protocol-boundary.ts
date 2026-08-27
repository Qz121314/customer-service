const REMOVED_PROTOCOL_PREFIXES = [
  '/api/public',
  '/management/v1',
  '/api/admin/conversations',
  '/api/admin/realtime',
] as const;

export function isRemovedProtocolPath(pathname: string): boolean {
  return REMOVED_PROTOCOL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function removedProtocolResponse(): Response {
  return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
}
