import { expect, test } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';

test('H5 chat entry starts a conversation and sends visitor text', async ({
  page,
}) => {
  const conversation = {
    id: 'h5-conversation-1',
    agent_name: 'H5 客服',
    product_title: 'Campaign H5',
  };
  const detail = {
    conversation,
    messages: [],
  };
  await page.route('**/client/v1/conversations', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ visitorToken: 'visitor-token', conversation }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ conversations: [] }),
    });
  });
  await page.route(
    '**/client/v1/conversations/h5-conversation-1?*',
    async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(detail),
      });
    },
  );
  await page.route(
    '**/client/v1/conversations/h5-conversation-1/messages',
    async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          message: {
            id: 'visitor-message-1',
            sender_type: 'visitor',
            body: 'Hello H5',
          },
        }),
      });
    },
  );
  await page.route(
    '**/client/v1/conversations/h5-conversation-1/read',
    async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    },
  );
  await page.goto(
    new URL(
      '/chat?productId=h5%3Aproduct%3Acampaign&sourceHandoffId=11111111-1111-4111-8111-111111111111',
      `${baseUrl}/`,
    ).toString(),
  );
  await expect(page.getByText('H5 客服')).toBeVisible();
  await page.getByLabel('发送消息').fill('Hello H5');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('Hello H5')).toBeVisible();
});
