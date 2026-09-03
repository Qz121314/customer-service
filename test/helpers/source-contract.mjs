const ROUTE_REGISTRATION = /\n[A-Za-z_$][\w$]*Api\.(?:get|post|put|patch|delete)\(/u;

/**
 * Scope a source-level cost/architecture guardrail to one stable API route.
 *
 * The route path is part of the public protocol contract. The helper deliberately
 * does not depend on the name or position of the next specific route, so moving,
 * inserting, or extracting unrelated handlers does not invalidate the test.
 */
export function routeRegistration(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Route marker not found: ${marker}`);
  }

  const remainder = source.slice(start + marker.length);
  const nextRegistration = remainder.match(ROUTE_REGISTRATION);
  const end = nextRegistration
    ? start + marker.length + nextRegistration.index
    : source.length;
  return source.slice(start, end);
}
