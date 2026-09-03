const ROUTE_REGISTRATION =
  /\n[A-Za-z_$][\w$]*Api\.(?:get|post|put|patch|delete)\(/u;
const TOP_LEVEL_DECLARATION =
  /\n(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+/u;
const CLASS_METHOD_DECLARATION =
  /\n  (?:(?:public|protected|private|static|abstract|override|readonly|async|get|set)\s+)*(?:constructor|[A-Za-z_$][\w$]*)\s*(?:<[^>\n]+>)?\(/u;

/**
 * Scope a source-level cost/architecture guardrail to one stable API route.
 *
 * The route path is part of the public protocol contract. The helper deliberately
 * does not depend on the name or position of the next specific route, so moving,
 * inserting, or extracting unrelated handlers does not invalidate the test.
 */
export function routeRegistration(source, marker) {
  return sourceContractBlock(source, marker, ROUTE_REGISTRATION, 'Route');
}

/**
 * Scope a source-level cost/architecture guardrail to one explicit top-level
 * implementation boundary without naming the declaration that happens to follow
 * it. Use this only when the starting declaration itself is the documented cost,
 * safety, or architecture boundary under test.
 */
export function topLevelDeclaration(source, marker) {
  return sourceContractBlock(
    source,
    marker,
    TOP_LEVEL_DECLARATION,
    'Top-level declaration',
  );
}

/**
 * Scope a source-level guardrail to one explicit class method without naming the
 * method that happens to follow it. The marker must identify the method under
 * test; missing markers fail instead of silently producing a partial slice.
 */
export function classMethodDeclaration(source, marker) {
  return sourceContractBlock(
    source,
    marker,
    CLASS_METHOD_DECLARATION,
    'Class method',
  );
}

function sourceContractBlock(source, marker, nextPattern, kind) {
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`${kind} marker not found: ${marker}`);
  }

  const remainder = source.slice(start + marker.length);
  const nextRegistration = remainder.match(nextPattern);
  const end = nextRegistration
    ? start + marker.length + nextRegistration.index
    : source.length;
  return source.slice(start, end);
}
