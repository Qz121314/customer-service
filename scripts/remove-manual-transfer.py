from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_required(text: str, old: str, new: str, label: str, count: int = 1) -> str:
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{label}: expected {count} matches, found {actual}")
    return text.replace(old, new)


def sub_required(text: str, pattern: str, repl: str, label: str, count: int = 1) -> str:
    updated, actual = re.subn(pattern, repl, text, count=count, flags=re.S)
    if actual != count:
        raise RuntimeError(f"{label}: expected {count} matches, found {actual}")
    return updated


def remove_css_rules_with_token(text: str, token: str) -> str:
    while token in text:
        token_at = text.index(token)
        open_at = text.find("{", token_at)
        if open_at < 0:
            raise RuntimeError(f"CSS token {token!r} has no rule block")
        previous_close = text.rfind("}", 0, token_at)
        previous_open = text.rfind("{", 0, token_at)
        start = max(previous_close, previous_open) + 1
        prelude = text[start:open_at].strip()
        selectors = [part.strip() for part in prelude.split(",") if part.strip()]
        if not selectors or any(token not in selector for selector in selectors):
            raise RuntimeError(
                f"Refusing to remove mixed CSS rule containing {token!r}: {prelude!r}"
            )
        depth = 0
        close_at = None
        for index in range(open_at, len(text)):
            char = text[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    close_at = index + 1
                    break
        if close_at is None:
            raise RuntimeError(f"Unbalanced CSS rule containing {token!r}")
        while close_at < len(text) and text[close_at] in " \t":
            close_at += 1
        if close_at < len(text) and text[close_at] == "\n":
            close_at += 1
        text = text[:start] + text[close_at:]
    return text


# Agent workspace: remove imports, state, realtime handling, action code and DOM.
path = "src/dashboard/AgentPortal.tsx"
text = read(path)
text = replace_required(text, "  TransferTarget,\n", "", "AgentPortal TransferTarget import")
text = replace_required(text, "  transferConversation,\n", "", "AgentPortal transferConversation import")
text = replace_required(
    text,
    "  const [transferTargets, setTransferTargets] = useState<TransferTarget[]>([]);\n"
    "  const [transferring, setTransferring] = useState(false);\n",
    "",
    "AgentPortal transfer state",
)
text = replace_required(
    text,
    "    setTransferTargets(inbox.transferTargets);\n",
    "",
    "AgentPortal inbox transfer targets",
)
text = sub_required(
    text,
    r"\n        if \(payload\.type === 'conversation\.transferred'\) \{\n"
    r"          setSelectedId\(null\);\n"
    r"          setDetail\(null\);\n"
    r"          void refresh\(\)\.catch\(\(\) => undefined\);\n"
    r"          return;\n"
    r"        \}\n",
    "\n",
    "AgentPortal transferred realtime branch",
)
text = sub_required(
    text,
    r"\n  async function handoffConversation\(targetAgentId: string \| null\) \{.*?\n  \}\n\n  return \(",
    "\n  return (",
    "AgentPortal handoff function",
)
text = sub_required(
    text,
    r"\n                \{detail\.conversation\.status !== 'closed' && \(\n"
    r"                  <details className=\"transfer-menu\">.*?\n"
    r"                  </details>\n"
    r"                \)\}",
    "",
    "AgentPortal transfer menu",
)
write(path, text)

# Dashboard API contract: transfer is not part of the product anymore.
path = "src/dashboard/api.ts"
text = read(path)
text = replace_required(text, "  transferTargets: TransferTarget[];\n", "", "AgentInbox transferTargets")
text = sub_required(
    text,
    r"\nexport type TransferTarget = \{.*?\n\};\n",
    "",
    "TransferTarget type",
)
text = replace_required(text, "  INVALID_TRANSFER_TARGET: '请选择有效的转接客服',\n", "", "transfer error message 1")
text = replace_required(text, "  TRANSFER_TARGET_UNAVAILABLE: '该客服当前无法接收新会话',\n", "", "transfer error message 2")
text = sub_required(
    text,
    r"\nexport async function transferConversation\(.*?\n\}\n\nexport function openAgentInboxSocket",
    "\nexport function openAgentInboxSocket",
    "transferConversation client API",
)
write(path, text)

# Realtime payload no longer carries a transfer-only assignment field.
path = "src/dashboard/dashboard-runtime.ts"
text = read(path)
text = replace_required(
    text,
    "  assignment?: { id: string; name: string } | null;\n",
    "",
    "ThreadRealtimeEvent assignment",
)
write(path, text)

# Remove the transfer-only icon from the icon registry.
path = "src/dashboard/icons.tsx"
text = read(path)
text = replace_required(text, "  ArrowLeftRight,\n", "", "ArrowLeftRight import")
text = replace_required(text, "  | 'transfer'\n", "", "transfer icon name")
text = replace_required(text, "  transfer: ArrowLeftRight,\n", "", "transfer icon map")
write(path, text)

# Worker API: delete transfer target query, endpoint, helpers and response fields.
path = "src/worker/agent-api.ts"
text = read(path)
text = replace_required(
    text,
    "import { assignConversationAgent, routingBusinessDate } from './routing';\n",
    "import { routingBusinessDate } from './routing';\n",
    "agent-api routing import",
)
text = sub_required(text, r"\ntype TransferTargetRow = \{.*?\n\};\n", "", "TransferTargetRow")
text = sub_required(text, r"\ntype TransferConversationRow = \{.*?\n\};\n", "", "TransferConversationRow")
text = sub_required(
    text,
    r"\nasync function loadTransferTargets\(db: D1Database, agentId: string\) \{.*?\n\}\n\nasync function loadAgentInbox",
    "\nasync function loadAgentInbox",
    "loadTransferTargets",
)
text = replace_required(
    text,
    "  const transferTargetsRequest = loadTransferTargets(db, agent.id);\n\n",
    "",
    "transferTargetsRequest",
)
text = replace_required(
    text,
    "    const [result, overview, transferTargets] = await Promise.all([\n",
    "    const [result, overview] = await Promise.all([\n",
    "filtered inbox Promise destructure",
)
text = replace_required(text, "      transferTargetsRequest,\n", "", "filtered transfer target request")
text = replace_required(text, "      transferTargets,\n", "", "filtered transfer target response")
text = replace_required(
    text,
    "  const [result, quotaOverview, transferTargets] = await Promise.all([\n",
    "  const [result, quotaOverview] = await Promise.all([\n",
    "inbox Promise destructure",
)
text = replace_required(text, "    transferTargetsRequest,\n", "", "inbox transfer target request")
text = replace_required(text, "    transferTargets,\n", "", "inbox transfer target response")
text = sub_required(
    text,
    r"\nagentApi\.post\('/api/agent/conversations/:id/transfer', async \(c\) => \{.*?\n\}\);\n\nagentApi\.get\('/api/agent/realtime/inbox'",
    "\nagentApi.get('/api/agent/realtime/inbox'",
    "agent transfer endpoint",
)
text = sub_required(
    text,
    r"\nasync function assignedConversationForTransfer\(.*?\n\}\n\nasync function assignedConversation\(",
    "\nasync function assignedConversation(",
    "assignedConversationForTransfer",
)
text = sub_required(
    text,
    r"\nfunction normalizeOptionalId\(value\?: string \| null\): string \| null \{.*?\n\}\n",
    "",
    "normalizeOptionalId",
)
write(path, text)

# Canonical router no longer carries a transfer/requeue exclusion parameter.
path = "src/worker/routing.ts"
text = read(path)
text = replace_required(
    text,
    " * can always be requeued without consuming another unit.\n",
    " * can be reassigned without consuming another unit.\n",
    "routing requeue comment",
)
text = replace_required(
    text,
    "export async function assignConversationAgent(\n"
    "  db: D1Database,\n"
    "  conversationId: string,\n"
    "  excludedAgentId: string | null = null,\n"
    "): Promise<AgentAssignmentResult | null> {\n",
    "export async function assignConversationAgent(\n"
    "  db: D1Database,\n"
    "  conversationId: string,\n"
    "): Promise<AgentAssignmentResult | null> {\n",
    "routing excluded parameter",
)
text = replace_required(text, "           c.requeue_excluded_agent_id,\n", "", "routing requeue context")
text = replace_required(
    text,
    "           AND (?4 = '' OR a.id <> ?4)\n"
    "           AND (\n"
    "             ctx.requeue_excluded_agent_id IS NULL\n"
    "             OR a.id <> ctx.requeue_excluded_agent_id\n"
    "           )\n",
    "",
    "routing exclusion predicates",
)
text = replace_required(
    text,
    "    .bind(conversationId, now, businessDate, excludedAgentId ?? '')\n",
    "    .bind(conversationId, now, businessDate)\n",
    "routing bind",
)
write(path, text)

# Protocol boundary should only own removed namespaces, not a deleted feature route.
path = "src/worker/protocol-boundary.ts"
text = read(path)
text = replace_required(
    text,
    "\nconst REMOVED_AGENT_TRANSFER_PATH =\n"
    "  /^\\/api\\/agent\\/conversations\\/[^/]+\\/transfer$/u;\n",
    "",
    "removed transfer protocol regex",
)
text = replace_required(
    text,
    "  if (REMOVED_AGENT_TRANSFER_PATH.test(pathname)) return true;\n",
    "",
    "removed transfer protocol check",
)
write(path, text)

# Remove all transfer-menu style rules. First simplify mixed selectors/layouts.
for css_path in sorted((ROOT / "src/dashboard").glob("*.css")):
    text = css_path.read_text(encoding="utf-8")
    text = text.replace(
        "  .workspace-shell .thread-status,\n"
        "  .workspace-shell .thread-status-action,\n"
        "  .workspace-shell .transfer-menu > summary {",
        "  .workspace-shell .thread-status,\n"
        "  .workspace-shell .thread-status-action {",
    )
    text = text.replace("grid-template-columns: auto auto 38px;", "grid-template-columns: auto auto;")
    text = remove_css_rules_with_token(text, "transfer-menu")
    css_path.write_text(text, encoding="utf-8")

# Tests should exercise the remaining product behavior, not a deleted feature.
path = "test/agent-browser-smoke.spec.mjs"
text = read(path)
text = text.replace("  await expect(page.locator('.transfer-menu')).toBeHidden();\n", "")
text = text.replace("  await expect(page.getByRole('button', { name: '转接' })).toHaveCount(0);\n", "")
write(path, text)

path = "test/protocol-boundary.test.mjs"
text = read(path)
text = replace_required(
    text,
    "    '/api/agent/conversations/abc/transfer',\n",
    "",
    "protocol transfer test path",
)
write(path, text)

# Remove the obsolete schema column with a forward migration. Historical migrations
# remain immutable so clean installs still reproduce production history correctly.
migration = ROOT / "migrations/0043_remove_manual_transfer_residue.sql"
if migration.exists():
    raise RuntimeError("0043 migration already exists")
migration.write_text(
    "PRAGMA foreign_keys = ON;\n\n"
    "-- Manual transfer has been removed. The requeue exclusion column was only\n"
    "-- used by that feature and is no longer part of the runtime routing model.\n"
    "ALTER TABLE conversations DROP COLUMN requeue_excluded_agent_id;\n",
    encoding="utf-8",
)

# The one-shot transformation must not become repository residue itself.
(ROOT / "scripts/remove-manual-transfer.py").unlink()
(ROOT / ".github/workflows/remove-manual-transfer.yml").unlink()

# No runtime/test/documentation implementation residue is allowed to survive.
roots = [ROOT / "src", ROOT / "test", ROOT / "scripts", ROOT / "docs", ROOT / "public"]
extra = [ROOT / "README.md", ROOT / "AGENTS.md"]
patterns = [
    "transferConversation",
    "TransferTarget",
    "transferTargets",
    "conversation.transferred",
    "transfer-menu",
    "INVALID_TRANSFER_TARGET",
    "TRANSFER_TARGET_UNAVAILABLE",
    "assignedConversationForTransfer",
    "loadTransferTargets",
    "handoffConversation",
    "requeue_excluded_agent_id",
    "excludedAgentId",
    "/transfer",
    "转接",
]
leftovers: list[str] = []
for root in roots:
    for file in root.rglob("*"):
        if not file.is_file() or file.suffix not in {".ts", ".tsx", ".js", ".mjs", ".css", ".md", ".json"}:
            continue
        content = file.read_text(encoding="utf-8")
        for pattern in patterns:
            if pattern in content:
                leftovers.append(f"{file.relative_to(ROOT)}: {pattern}")
for file in extra:
    content = file.read_text(encoding="utf-8")
    for pattern in patterns:
        if pattern in content:
            leftovers.append(f"{file.relative_to(ROOT)}: {pattern}")
if leftovers:
    raise RuntimeError("Manual transfer residue remains:\n" + "\n".join(sorted(set(leftovers))))

print("Manual transfer implementation removed with no runtime/test/docs residue.")
