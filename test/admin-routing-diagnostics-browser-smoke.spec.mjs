import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

test('admin routing diagnostics stays in header composition without duplicate bootstrap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const adminLogin = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  let adminBootstrapRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/admin/bootstrap') {
      adminBootstrapRequests += 1;
    }
  });

  await page.goto(url('/'));

  const heading = page.getByRole('heading', { name: '客服坐席' });
  const diagnoseTrigger = page.getByRole('button', {
    name: '分流诊断',
    exact: true,
  });
  const createAgent = page.getByRole('button', {
    name: '新增客服',
    exact: true,
  });
  await expect(heading).toBeVisible();
  await expect(diagnoseTrigger).toBeVisible();
  await expect(createAgent).toBeVisible();
  await expect.poll(() => adminBootstrapRequests).toBe(1);

  const mobileTriggerBox = await diagnoseTrigger.boundingBox();
  const mobileCreateBox = await createAgent.boundingBox();
  expect(mobileTriggerBox).not.toBeNull();
  expect(mobileCreateBox).not.toBeNull();
  if (mobileTriggerBox && mobileCreateBox) {
    expect(mobileTriggerBox.x).toBeGreaterThanOrEqual(0);
    expect(mobileTriggerBox.x + mobileTriggerBox.width).toBeLessThanOrEqual(
      390,
    );
    expect(mobileTriggerBox.height).toBeGreaterThanOrEqual(36);
    expect(mobileCreateBox.x).toBeGreaterThanOrEqual(0);
    expect(mobileCreateBox.x + mobileCreateBox.width).toBeLessThanOrEqual(390);
  }

  await diagnoseTrigger.click();
  const diagnoseDialog = page.getByRole('dialog', { name: '分流诊断' });
  await expect(diagnoseDialog).toBeVisible();
  await expect.poll(() => adminBootstrapRequests).toBe(1);

  const mobileDialogBox = await diagnoseDialog.boundingBox();
  expect(mobileDialogBox).not.toBeNull();
  if (mobileDialogBox) {
    expect(mobileDialogBox.x).toBeGreaterThanOrEqual(0);
    expect(mobileDialogBox.y).toBeGreaterThanOrEqual(0);
    expect(mobileDialogBox.x + mobileDialogBox.width).toBeLessThanOrEqual(390);
    expect(mobileDialogBox.y + mobileDialogBox.height).toBeLessThanOrEqual(844);
  }

  const mobileRootGeometry = await page.evaluate(() => {
    const root = globalThis.document.scrollingElement;
    return root
      ? { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth }
      : null;
  });
  expect(mobileRootGeometry).not.toBeNull();
  if (mobileRootGeometry) {
    expect(mobileRootGeometry.scrollWidth).toBeLessThanOrEqual(
      mobileRootGeometry.clientWidth + 1,
    );
  }

  await page.keyboard.press('Escape');
  await expect(diagnoseDialog).toBeHidden();

  await page.setViewportSize({ width: 1440, height: 760 });
  await expect(diagnoseTrigger).toBeVisible();
  await expect(createAgent).toBeVisible();

  const desktopHeadingBox = await heading.boundingBox();
  const desktopTriggerBox = await diagnoseTrigger.boundingBox();
  const desktopCreateBox = await createAgent.boundingBox();
  expect(desktopHeadingBox).not.toBeNull();
  expect(desktopTriggerBox).not.toBeNull();
  expect(desktopCreateBox).not.toBeNull();
  if (desktopHeadingBox && desktopTriggerBox && desktopCreateBox) {
    expect(desktopTriggerBox.x).toBeGreaterThan(
      desktopHeadingBox.x + desktopHeadingBox.width,
    );
    expect(desktopTriggerBox.x + desktopTriggerBox.width).toBeLessThanOrEqual(
      desktopCreateBox.x,
    );
    expect(desktopCreateBox.x + desktopCreateBox.width).toBeLessThanOrEqual(
      1440,
    );
  }

  await diagnoseTrigger.click();
  await expect(diagnoseDialog).toBeVisible();
  await expect.poll(() => adminBootstrapRequests).toBe(1);

  const desktopDialogBox = await diagnoseDialog.boundingBox();
  expect(desktopDialogBox).not.toBeNull();
  if (desktopDialogBox) {
    expect(desktopDialogBox.x).toBeGreaterThanOrEqual(0);
    expect(desktopDialogBox.y).toBeGreaterThanOrEqual(0);
    expect(desktopDialogBox.x + desktopDialogBox.width).toBeLessThanOrEqual(
      1440,
    );
    expect(desktopDialogBox.y + desktopDialogBox.height).toBeLessThanOrEqual(
      760,
    );
  }

  await diagnoseDialog
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(diagnoseDialog).toBeHidden();
});
