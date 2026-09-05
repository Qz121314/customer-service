import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAgentReminderDelivery,
  resumeAgentAudio,
} from '../src/dashboard/agent-reminders.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const reminder = (messageId = 'm1') => ({
  type: 'CUSTOMER_REPLY',
  messageId,
  conversationId: 'c1',
});

test('Android and iOS use one system reminder for duplicate inbox/thread events', async () => {
  for (const vibrationSupported of [true, false]) {
    const sent = [];
    const local = [];
    const delivery = createAgentReminderDelivery({
      vibrationSupported,
      async system(value) {
        sent.push(value.messageId);
        return true;
      },
      async sound() {
        local.push('sound');
        return true;
      },
      vibrate() {
        local.push('vibration');
        return true;
      },
    });
    delivery.receive(reminder());
    delivery.receive(reminder());
    await tick();
    delivery.receive(reminder());
    delivery.receive(reminder('m2'));
    delivery.receive(reminder('m3'));
    await tick();
    assert.deepEqual(sent, ['m1', 'm2', 'm3']);
    assert.deepEqual(local, []);
  }
});

test('PC without system permission plays each message and never calls vibration', async () => {
  const sounds = [];
  let vibrations = 0;
  const delivery = createAgentReminderDelivery({
    vibrationSupported: false,
    async system() {
      return false;
    },
    async sound(type) {
      sounds.push(type);
      return true;
    },
    vibrate() {
      vibrations++;
      return false;
    },
  });
  delivery.receive(reminder());
  delivery.receive({ ...reminder('m2'), type: 'NEW_CONVERSATION' });
  await tick();
  delivery.retry();
  await tick();
  assert.deepEqual(sounds, ['CUSTOMER_REPLY', 'NEW_CONVERSATION']);
  assert.equal(vibrations, 0);
});

test('failed audio retries after interaction without repeating accepted vibration', async () => {
  let sounds = 0,
    vibrations = 0,
    systems = 0;
  const pending = [];
  const delivery = createAgentReminderDelivery({
    vibrationSupported: true,
    async system() {
      systems++;
      return false;
    },
    async sound() {
      return ++sounds > 1;
    },
    vibrate() {
      vibrations++;
      return true;
    },
    changed(value) {
      pending.push(value);
    },
  });
  delivery.receive(reminder());
  await tick();
  assert.equal(pending.at(-1), true);
  delivery.retry();
  await tick();
  delivery.receive(reminder());
  await tick();
  assert.equal(sounds, 2);
  assert.equal(vibrations, 1);
  assert.equal(systems, 1);
  assert.equal(pending.at(-1), false);
});

test('rejected vibration retries without repeating successful audio', async () => {
  let sounds = 0,
    vibrations = 0;
  const delivery = createAgentReminderDelivery({
    vibrationSupported: true,
    async system() {
      throw Error('unavailable');
    },
    async sound() {
      sounds++;
      return true;
    },
    vibrate() {
      return ++vibrations > 1;
    },
  });
  delivery.receive(reminder());
  await tick();
  delivery.retry();
  await tick();
  assert.equal(sounds, 1);
  assert.equal(vibrations, 2);
});

test('a failed system request consumes no reminder and all failed channels retry', async () => {
  let allowed = false,
    attempts = 0;
  const delivery = createAgentReminderDelivery({
    vibrationSupported: true,
    async system() {
      attempts++;
      return allowed;
    },
    async sound() {
      return false;
    },
    vibrate() {
      return false;
    },
  });
  delivery.receive(reminder());
  await tick();
  allowed = true;
  delivery.retry();
  await tick();
  delivery.retry();
  await tick();
  assert.equal(attempts, 2);
});

test('missing durable identity does not notify, and logout prevents late fallback', async () => {
  let finish;
  let fallbacks = 0;
  const delivery = createAgentReminderDelivery({
    vibrationSupported: true,
    system() {
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    async sound() {
      fallbacks++;
      return true;
    },
    vibrate() {
      fallbacks++;
      return true;
    },
  });
  delivery.receive(reminder(''));
  assert.equal(finish, undefined);
  delivery.receive(reminder());
  delivery.dispose();
  finish(false);
  await tick();
  assert.equal(fallbacks, 0);
});

test('audio resumes suspended and interrupted contexts, and reports rejection', async () => {
  for (const state of ['suspended', 'interrupted']) {
    const context = {
      state,
      async resume() {
        this.state = 'running';
      },
    };
    assert.equal(await resumeAgentAudio(context), true);
  }
  assert.equal(
    await resumeAgentAudio({
      state: 'suspended',
      async resume() {
        throw Error('blocked');
      },
    }),
    false,
  );
});

test('browser autoplay resume that never settles remains retryable', async () => {
  assert.equal(
    await resumeAgentAudio({
      state: 'suspended',
      resume() {
        return new Promise(() => {});
      },
    }),
    false,
  );
});
