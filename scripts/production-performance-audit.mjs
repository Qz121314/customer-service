import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.env.BASE_URL;
const adminPassword = process.env.PERF_AUDIT_ADMIN_PASSWORD;
const agentUsername = process.env.PERF_AUDIT_AGENT_USERNAME;
const agentPassword = process.env.PERF_AUDIT_AGENT_PASSWORD;
const runCount = Number.parseInt(process.env.PERF_AUDIT_RUNS ?? '3', 10);
const outputPath =
  process.env.PERF_AUDIT_OUTPUT ?? '/tmp/production-performance-audit.json';
const summaryPath =
  process.env.PERF_AUDIT_SUMMARY ?? '/tmp/production-performance-audit.md';
const enforce = process.env.PERF_AUDIT_ENFORCE === '1';

if (!baseUrl) {
  throw new Error('BASE_URL is required.');
}
if (!adminPassword) {
  throw new Error('PERF_AUDIT_ADMIN_PASSWORD is required.');
}
if (!agentUsername || !agentPassword) {
  throw new Error(
    'PERF_AUDIT_AGENT_USERNAME and PERF_AUDIT_AGENT_PASSWORD are required.',
  );
}
if (!Number.isInteger(runCount) || runCount < 1 || runCount > 9) {
  throw new Error('PERF_AUDIT_RUNS must be an integer between 1 and 9.');
}

const absoluteUrl = (path) =>
  new URL(path, `${baseUrl.replace(/\/$/, '')}/`).toString();

const thresholds = {
  lcpMs: 2000,
  loadMs: 1500,
  cssRequests: 3,
  jsRequests: 5,
  criticalDependencyDepth: 3,
  adminTotalRequests: 22,
  agentTotalRequests: 18,
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getInitiatorUrl(initiator) {
  if (!initiator) return null;
  if (initiator.url) return initiator.url;
  const frames = initiator.stack?.callFrames ?? [];
  return frames.find((frame) => frame.url)?.url ?? null;
}

function calculateDependencyDepth(requests) {
  const criticalTypes = new Set(['Document', 'Stylesheet', 'Script', 'Font']);
  const byUrl = new Map();

  for (const request of requests.values()) {
    if (!criticalTypes.has(request.type)) continue;
    if (!byUrl.has(request.url)) byUrl.set(request.url, request);
  }

  const cache = new Map();
  function depth(url, visiting = new Set()) {
    if (!url || !byUrl.has(url)) return 0;
    if (cache.has(url)) return cache.get(url);
    if (visiting.has(url)) return 1;

    const request = byUrl.get(url);
    const parentUrl = request.initiatorUrl;
    if (!parentUrl || parentUrl === url || !byUrl.has(parentUrl)) {
      cache.set(url, 1);
      return 1;
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(url);
    const value = 1 + depth(parentUrl, nextVisiting);
    cache.set(url, value);
    return value;
  }

  let maxDepth = 0;
  for (const url of byUrl.keys()) {
    maxDepth = Math.max(maxDepth, depth(url));
  }
  return maxDepth;
}

async function adminStorageState(browser) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const response = await context.request.post(
      absoluteUrl('/api/auth/login'),
      {
        data: { password: adminPassword },
      },
    );
    if (!response.ok()) {
      throw new Error(`Admin login failed with HTTP ${response.status()}.`);
    }
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function agentStorageState(browser) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.goto(absoluteUrl('/agent'), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.getByLabel('客服账号').fill(agentUsername);
    await page.getByLabel('登录密码').fill(agentPassword);
    await page.getByRole('button', { name: '进入工作台' }).click();
    await page
      .getByText('我的会话')
      .waitFor({ state: 'visible', timeout: 30_000 });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function measureRun(browser, surface, storageState, runNumber) {
  const context = await browser.newContext({
    storageState,
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  });

  await context.addInitScript(() => {
    globalThis.__productionPerformanceAudit = { lcp: 0 };
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries.at(-1);
      if (last) globalThis.__productionPerformanceAudit.lcp = last.startTime;
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const requests = new Map();

  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  cdp.on('Network.requestWillBeSent', (event) => {
    requests.set(event.requestId, {
      requestId: event.requestId,
      url: event.request.url,
      type: event.type ?? 'Other',
      initiatorUrl: getInitiatorUrl(event.initiator),
      encodedDataLength: 0,
      status: null,
    });
  });

  cdp.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    request.type = event.type ?? request.type;
    request.status = event.response.status;
  });

  cdp.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    request.encodedDataLength = event.encodedDataLength ?? 0;
  });

  try {
    await page.goto(absoluteUrl(surface.path), {
      waitUntil: 'load',
      timeout: 30_000,
    });
    await surface.verify(page);
    await page.waitForTimeout(1000);

    const timings = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      return {
        lcpMs: globalThis.__productionPerformanceAudit?.lcp ?? 0,
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
        loadMs: navigation?.loadEventEnd ?? 0,
      };
    });

    const successfulRequests = [...requests.values()].filter(
      (request) => request.status === null || request.status < 400,
    );
    const cssRequests = successfulRequests.filter(
      (request) => request.type === 'Stylesheet',
    ).length;
    const jsRequests = successfulRequests.filter(
      (request) => request.type === 'Script',
    ).length;
    const transferredBytes = successfulRequests.reduce(
      (sum, request) => sum + request.encodedDataLength,
      0,
    );

    return {
      run: runNumber,
      lcpMs: round(timings.lcpMs),
      domContentLoadedMs: round(timings.domContentLoadedMs),
      loadMs: round(timings.loadMs),
      cssRequests,
      jsRequests,
      totalRequests: successfulRequests.length,
      transferredBytes: Math.round(transferredBytes),
      transferredKb: round(transferredBytes / 1024),
      criticalDependencyDepth: calculateDependencyDepth(requests),
    };
  } finally {
    await cdp.detach();
    await context.close();
  }
}

function summarize(surface, runs) {
  const metric = (key) => median(runs.map((run) => run[key]));
  const summary = {
    lcpMs: round(metric('lcpMs')),
    domContentLoadedMs: round(metric('domContentLoadedMs')),
    loadMs: round(metric('loadMs')),
    cssRequests: metric('cssRequests'),
    jsRequests: metric('jsRequests'),
    totalRequests: metric('totalRequests'),
    transferredKb: round(metric('transferredKb')),
    criticalDependencyDepth: metric('criticalDependencyDepth'),
  };

  const totalRequestThreshold =
    surface.id === 'admin'
      ? thresholds.adminTotalRequests
      : thresholds.agentTotalRequests;

  const checks = {
    lcp: summary.lcpMs > 0 && summary.lcpMs < thresholds.lcpMs,
    load: summary.loadMs < thresholds.loadMs,
    cssRequests: summary.cssRequests <= thresholds.cssRequests,
    jsRequests: summary.jsRequests <= thresholds.jsRequests,
    totalRequests: summary.totalRequests <= totalRequestThreshold,
    criticalDependencyDepth:
      summary.criticalDependencyDepth <= thresholds.criticalDependencyDepth,
  };

  return {
    ...surface,
    runs,
    median: summary,
    thresholds: {
      lcpMs: thresholds.lcpMs,
      loadMs: thresholds.loadMs,
      cssRequests: thresholds.cssRequests,
      jsRequests: thresholds.jsRequests,
      totalRequests: totalRequestThreshold,
      criticalDependencyDepth: thresholds.criticalDependencyDepth,
    },
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function status(value) {
  return value ? 'PASS' : 'FAIL';
}

function markdownReport(report) {
  const lines = [
    '# Production performance audit',
    '',
    `- Base URL: ${report.baseUrl}`,
    `- Cold-cache runs per surface: ${report.runCount}`,
    `- Overall: ${status(report.passed)}`,
    '',
    '| Surface | LCP | Load | CSS | JS | Total req. | Transfer | Chain depth | Result |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const surface of report.surfaces) {
    lines.push(
      `| ${surface.name} | ${surface.median.lcpMs} ms | ${surface.median.loadMs} ms | ${surface.median.cssRequests} | ${surface.median.jsRequests} | ${surface.median.totalRequests} | ${surface.median.transferredKb} KB | ${surface.median.criticalDependencyDepth} | ${status(surface.passed)} |`,
    );
  }

  lines.push('', '## Threshold checks', '');
  for (const surface of report.surfaces) {
    lines.push(
      `### ${surface.name}`,
      '',
      `- LCP < ${surface.thresholds.lcpMs} ms: ${status(surface.checks.lcp)}`,
      `- Load < ${surface.thresholds.loadMs} ms: ${status(surface.checks.load)}`,
      `- Initial CSS requests <= ${surface.thresholds.cssRequests}: ${status(surface.checks.cssRequests)}`,
      `- Initial JS requests <= ${surface.thresholds.jsRequests}: ${status(surface.checks.jsRequests)}`,
      `- Total requests <= ${surface.thresholds.totalRequests}: ${status(surface.checks.totalRequests)}`,
      `- Critical dependency depth <= ${surface.thresholds.criticalDependencyDepth}: ${status(surface.checks.criticalDependencyDepth)}`,
      '',
    );
  }

  lines.push(
    '> Critical dependency depth is derived from Chromium CDP initiator relationships for Document, Stylesheet, Script and Font requests. It is a deterministic production audit metric, not the Lighthouse audit label.',
    '',
  );

  return `${lines.join('\n')}\n`;
}

const surfaces = [
  {
    id: 'admin',
    name: 'Admin dashboard',
    path: '/',
    verify: (page) =>
      page.getByRole('heading', { name: '客服坐席' }).waitFor({
        state: 'visible',
        timeout: 30_000,
      }),
  },
  {
    id: 'agent',
    name: 'Agent workbench',
    path: '/agent',
    verify: (page) =>
      page.getByText('我的会话').waitFor({ state: 'visible', timeout: 30_000 }),
  },
];

const browser = await chromium.launch({ headless: true });
try {
  const storageStates = {
    admin: await adminStorageState(browser),
    agent: await agentStorageState(browser),
  };

  const surfaceReports = [];
  for (const surface of surfaces) {
    const runs = [];
    for (let runNumber = 1; runNumber <= runCount; runNumber += 1) {
      runs.push(
        await measureRun(
          browser,
          surface,
          storageStates[surface.id],
          runNumber,
        ),
      );
    }
    surfaceReports.push(summarize(surface, runs));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    runCount,
    coldCache: true,
    serviceWorkerBlocked: true,
    thresholds,
    surfaces: surfaceReports,
    passed: surfaceReports.every((surface) => surface.passed),
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(summaryPath, markdownReport(report), 'utf8');

  console.log(markdownReport(report));

  if (enforce && !report.passed) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
