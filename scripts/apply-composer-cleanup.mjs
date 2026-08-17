import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function requiredReplace(text, search, replacement, label) {
  if (!text.includes(search)) throw new Error(`Missing replacement target: ${label}`);
  return text.replace(search, replacement);
}

function requiredRegex(text, pattern, replacement, label) {
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error(`Missing regex target: ${label}`);
  return next;
}

function removeBetween(text, startMarker, endMarker, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing start marker: ${label}`);
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Missing end marker: ${label}`);
  return text.slice(0, start) + text.slice(end);
}

function nextOpenBrace(text, start) {
  let quote = null;
  let comment = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        i += 1;
      }
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      comment = true;
      i += 1;
      continue;
    }
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') return i;
  }
  return -1;
}

function matchingCloseBrace(text, open) {
  let depth = 1;
  let quote = null;
  let comment = false;
  for (let i = open + 1; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        i += 1;
      }
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      comment = true;
      i += 1;
      continue;
    }
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('Unbalanced CSS braces');
}

function stripQuickReplyCss(text) {
  let cursor = 0;
  let output = '';
  while (cursor < text.length) {
    const open = nextOpenBrace(text, cursor);
    if (open < 0) {
      output += text.slice(cursor);
      break;
    }
    const close = matchingCloseBrace(text, open);
    const prelude = text.slice(cursor, open);
    const body = text.slice(open + 1, close);
    const trimmed = prelude.trim();
    const leading = prelude.match(/^\s*/u)?.[0] ?? '';

    if (trimmed.startsWith('@')) {
      output += `${prelude}{${stripQuickReplyCss(body)}}`;
    } else if (trimmed.includes('quick-repl')) {
      const selectors = trimmed
        .split(',')
        .map((selector) => selector.trim())
        .filter((selector) => selector && !selector.includes('quick-repl'));
      if (selectors.length > 0) {
        output += `${leading}${selectors.join(',\n')}{${body}}`;
      }
    } else {
      output += `${prelude}{${body}}`;
    }
    cursor = close + 1;
  }
  return output;
}

async function updateAgentPortal() {
  const path = 'src/dashboard/AgentPortal.tsx';
  let text = await readFile(path, 'utf8');
  text = requiredReplace(text, '  QuickReply,\n', '', 'QuickReply import');
  text = requiredReplace(text, '  createQuickReply,\n', '', 'createQuickReply import');
  text = requiredReplace(text, '  deleteQuickReply,\n', '', 'deleteQuickReply import');
  text = requiredRegex(
    text,
    /\n  const \[quickReplies, setQuickReplies\] = useState<QuickReply\[]>\(\[]\);[\s\S]*?  const \[quickReplySaving, setQuickReplySaving\] = useState\(false\);\n/u,
    '\n',
    'quick reply state',
  );
  text = requiredReplace(
    text,
    "  const quickReplySearchRef = useRef<HTMLInputElement | null>(null);\n",
    '',
    'quick reply ref',
  );
  text = requiredRegex(
    text,
    /  const filteredQuickReplies = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[quickReplies, quickReplySearch\]\);\n/u,
    '',
    'filtered quick replies',
  );
  text = requiredReplace(text, '    setQuickReplies(inbox.quickReplies);\n', '', 'apply inbox quick replies');
  text = requiredReplace(
    text,
    "    setQuickRepliesOpen(false);\n    setQuickReplySearch('');\n",
    '',
    'conversation quick reply reset',
  );
  text = requiredRegex(
    text,
    /\n  async function saveQuickReply\(\) \{[\s\S]*?\n  function closeQuickReplies\(\) \{[\s\S]*?\n  \}\n\n  return \(/u,
    '\n  return (',
    'quick reply helpers',
  );
  text = removeBetween(
    text,
    '                <div className="quick-replies">\n',
    '              </div>\n              <textarea\n',
    'quick reply composer UI',
  );
  text = requiredRegex(
    text,
    /                  if \(\n                    event\.key === '\/' &&[\s\S]*?                  if \(event\.key === 'Escape' && quickRepliesOpen\) \{[\s\S]*?                    return;\n                  \}\n/u,
    '',
    'quick reply keyboard shortcuts',
  );
  if (/QuickReply|quickReply|quick-repl|快捷回复/u.test(text)) {
    throw new Error('AgentPortal still contains quick reply references');
  }
  await writeFile(path, text);
}

async function updateApi() {
  const path = 'src/dashboard/api.ts';
  let text = await readFile(path, 'utf8');
  text = requiredRegex(
    text,
    /^import \{[\s\S]*?\} from '\.\/agent-local-quick-replies\.ts';\n\n/u,
    '',
    'local quick reply import',
  );
  text = requiredReplace(text, '  quickReplies: QuickReply[];\n', '', 'AgentInbox quick replies');
  text = requiredRegex(
    text,
    /\nexport type QuickReply = \{[\s\S]*?\n\};\n\ntype AgentInboxPayload = Omit<AgentInbox, 'quickReplies'> & \{[\s\S]*?\n\};\n/u,
    '',
    'quick reply types',
  );
  text = requiredRegex(
    text,
    /export async function getAgentSession\(\): Promise<AgentSessionState> \{[\s\S]*?\n\}\n\nexport async function agentLogin/u,
    "export async function getAgentSession(): Promise<AgentSessionState> {\n  return request('/api/agent/auth/session');\n}\n\nexport async function agentLogin",
    'agent session local quick reply binding',
  );
  text = requiredReplace(text, '  setLocalQuickReplyAgent(response.agent.id);\n', '', 'login quick reply binding');
  text = requiredReplace(text, '  setLocalQuickReplyAgent(null);\n', '', 'logout quick reply binding');
  text = requiredRegex(
    text,
    /export async function heartbeat\(\): Promise<AgentInbox> \{[\s\S]*?\n\}\n\nexport async function setAgentAvailability/u,
    "export async function heartbeat(): Promise<AgentInbox> {\n  return request<AgentInbox>('/api/agent/auth/heartbeat', { method: 'POST' });\n}\n\nexport async function setAgentAvailability",
    'heartbeat local quick replies',
  );
  text = requiredRegex(
    text,
    /export async function setAgentAvailability\([\s\S]*?\n\}\n\nexport async function getOverview/u,
    "export async function setAgentAvailability(\n  status: AgentAvailability,\n): Promise<AgentInbox> {\n  return request<AgentInbox>('/api/agent/auth/status', {\n    method: 'POST',\n    body: JSON.stringify({ status }),\n  });\n}\n\nexport async function getOverview",
    'availability local quick replies',
  );
  text = requiredRegex(
    text,
    /export async function getAgentInbox\(\): Promise<AgentInbox> \{[\s\S]*?\n\}\n\nexport async function getConversation/u,
    "export async function getAgentInbox(): Promise<AgentInbox> {\n  return request<AgentInbox>('/api/agent/conversations');\n}\n\nexport async function getConversation",
    'inbox local quick replies',
  );
  text = requiredRegex(
    text,
    /\nexport async function createQuickReply\([\s\S]*?\nexport async function deleteQuickReply\(id: string\): Promise<void> \{[\s\S]*?\n\}\n/u,
    '',
    'quick reply API helpers',
  );
  text = requiredRegex(
    text,
    /\nfunction withLocalQuickReplies\(payload: AgentInboxPayload\): AgentInbox \{[\s\S]*?\n\}\n/u,
    '',
    'withLocalQuickReplies',
  );
  if (/QuickReply|quickReply|quick-repl|快捷回复/u.test(text)) {
    throw new Error('api.ts still contains quick reply references');
  }
  await writeFile(path, text);
}

async function updateBrowserSmoke() {
  const path = 'test/agent-browser-smoke.spec.mjs';
  let text = await readFile(path, 'utf8');
  text = requiredRegex(
    text,
    /  let quickReplyServerRequests = 0;[\s\S]*?  \}\);\n\n  await seedConversationAndAgent/u,
    '  await seedConversationAndAgent',
    'quick reply request tracking',
  );
  text = removeBetween(
    text,
    "  const quickReplyTrigger = page.locator('.quick-replies-trigger');\n",
    '  await page.setViewportSize({ width: 390, height: 700 });\n',
    'browser quick reply flow',
  );
  text = requiredRegex(
    text,
    /  const quickReplyBox = await page[\s\S]*?  expect\(quickReplyBox\?\.height \?\? 0\)\.toBeGreaterThanOrEqual\(38\);\n/u,
    '',
    'quick reply mobile size assertion',
  );
  text = requiredReplace(
    text,
    "  const backButton = page.getByRole('button', { name: '返回会话列表' });\n",
    "  const sendButton = page.getByRole('button', { name: '发送' });\n  const sendButtonBox = await sendButton.boundingBox();\n  expect(sendButtonBox).not.toBeNull();\n  if (sendButtonBox && viewport) {\n    expect(sendButtonBox.x).toBeGreaterThanOrEqual(0);\n    expect(sendButtonBox.x + sendButtonBox.width).toBeLessThanOrEqual(\n      viewport.width + 1,\n    );\n  }\n\n  const backButton = page.getByRole('button', { name: '返回会话列表' });\n",
    'send button viewport assertion',
  );
  if (/quickReply|quick-repl|快捷回复/u.test(text)) {
    throw new Error('Browser smoke still contains quick reply references');
  }
  await writeFile(path, text);
}

async function updateMobileContract() {
  const path = 'test/agent-mobile-layout-contract.test.mjs';
  let text = await readFile(path, 'utf8');
  text = requiredReplace(
    text,
    "    mobileCss.includes('grid-template-columns: auto minmax(0, 1fr) 44px;'),\n",
    "    mobileCss.includes('grid-template-columns: 40px minmax(0, 1fr) 44px;'),\n",
    'mobile composer grid expectation',
  );
  text = requiredReplace(
    text,
    "  assert.ok(mobileCss.includes('.workspace-shell .quick-replies-panel'));\n",
    "  assert.ok(!app.includes('quick-replies'));\n  assert.ok(!mobileCss.includes('quick-repl'));\n",
    'mobile quick reply expectation',
  );
  await writeFile(path, text);
}

async function updateTransferContract() {
  const oldPath = 'test/agent-transfer-quick-replies.test.mjs';
  const newPath = 'test/agent-transfer-context.test.mjs';
  let text = await readFile(oldPath, 'utf8');
  text = requiredReplace(
    text,
    "test('agent workspace exposes transfer, requeue, local quick replies and product context', async () => {\n  const [worker, routing, dashboard, localReplies, styles] = await Promise.all([\n",
    "test('agent workspace exposes transfer, requeue and product context', async () => {\n  const [worker, routing, dashboard, styles] = await Promise.all([\n",
    'transfer contract title and tuple',
  );
  text = requiredReplace(
    text,
    "    read('../src/dashboard/AgentPortal.tsx'),\n    read('../src/dashboard/agent-local-quick-replies.ts'),\n    read('../src/dashboard/cloud-service-ui.css'),\n",
    "    read('../src/dashboard/AgentPortal.tsx'),\n    read('../src/dashboard/cloud-service-ui.css'),\n",
    'transfer contract reads',
  );
  text = requiredReplace(text, '  assert.match(dashboard, /快捷回复/u);\n', "  assert.doesNotMatch(dashboard, /快捷回复/u);\n", 'transfer quick reply assertion');
  text = requiredReplace(text, '  assert.match(localReplies, /window\\.localStorage/u);\n', '', 'local storage assertion');
  text = requiredReplace(text, '  assert.match(styles, /\\.quick-replies-panel/u);\n', "  assert.doesNotMatch(styles, /\\.quick-repl/u);\n", 'quick reply CSS assertion');
  await writeFile(oldPath, text);
  await rename(oldPath, newPath);
}

async function updateReadme() {
  const path = 'README.md';
  let text = await readFile(path, 'utf8');
  text = requiredReplace(
    text,
    '- 前端能够本地完成的筛选、搜索、快捷回复和草稿不消耗 Worker / D1；\n',
    '- 前端能够本地完成的筛选、搜索和草稿不消耗 Worker / D1；\n',
    'README principle',
  );
  text = requiredReplace(text, '- 个人快捷回复；\n', '', 'README agent capability');
  text = removeBetween(text, '### 4.1 快捷回复\n', '### 4.2 客服头像\n', 'README quick reply section');
  text = requiredReplace(text, '### 4.2 客服头像\n', '### 4.1 客服头像\n', 'README avatar heading');
  text = requiredReplace(
    text,
    '- 快捷回复和输入草稿完全本地化；\n',
    '- 输入草稿完全本地化；\n',
    'README resource strategy',
  );
  if (/快捷回复|agent-local-quick-replies/u.test(text)) {
    throw new Error('README still contains quick reply references');
  }
  await writeFile(path, text);
}

async function updateCss() {
  const paths = [
    'src/dashboard/styles.css',
    'src/dashboard/cloud-service-ui.css',
    'src/dashboard/ui-polish.css',
    'src/dashboard/agent-workspace.css',
    'src/dashboard/agent-desktop.css',
    'src/dashboard/agent-mobile.css',
  ];
  for (const path of paths) {
    let text = await readFile(path, 'utf8');
    text = stripQuickReplyCss(text);
    if (path.endsWith('agent-mobile.css')) {
      text = requiredReplace(
        text,
        '    grid-template-columns: auto minmax(0, 1fr) 44px;\n',
        '    grid-template-columns: 40px minmax(0, 1fr) 44px;\n',
        'mobile composer fixed columns',
      );
      text = requiredReplace(
        text,
        '    width: auto;\n    min-width: 0;\n    height: 44px;\n',
        '    width: 40px;\n    min-width: 40px;\n    height: 44px;\n',
        'mobile composer tools width',
      );
      text = requiredReplace(
        text,
        '  .workspace-shell .composer {\n    padding-inline: 6px;\n    gap: 3px;\n  }\n',
        '  .workspace-shell .composer {\n    grid-template-columns: 33px minmax(0, 1fr) 42px;\n    padding-inline: 6px;\n    gap: 3px;\n  }\n',
        'narrow mobile composer grid',
      );
    }
    if (/quick-repl/u.test(text)) throw new Error(`${path} still contains quick reply CSS`);
    await writeFile(path, text);
  }
}

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else files.push(child);
  }
  return files;
}

await updateAgentPortal();
await updateApi();
await updateBrowserSmoke();
await updateMobileContract();
await updateTransferContract();
await updateReadme();
await updateCss();
await rm('src/dashboard/agent-local-quick-replies.ts');
await rm('test/agent-local-quick-replies.test.mjs');

const candidates = [...(await walk('src')), ...(await walk('test')), 'README.md'];
const leftovers = [];
for (const path of candidates) {
  if (!/\.(?:ts|tsx|mjs|css|md)$/u.test(path)) continue;
  const text = await readFile(path, 'utf8');
  if (/QuickReply|quickReply|quick-repl|快捷回复|agent-local-quick-replies/u.test(text)) {
    leftovers.push(path);
  }
}
if (leftovers.length > 0) {
  throw new Error(`Quick reply references remain in: ${leftovers.join(', ')}`);
}

console.log('Composer cleanup applied successfully.');
