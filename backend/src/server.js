import app from './app.js';
import { notify } from './services/notificationService.js';
import { sendSubscriptionReminders } from './services/subscriptionService.js';

const port = Number(process.env.PORT) || 3000;
// Behind a reverse proxy on the same machine, HOST=127.0.0.1 keeps the API reachable only through it.
// Unset, it listens on every address, as in local development.
const host = process.env.HOST || undefined;
const REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000;

app.listen(port, host, () => {
  console.log(`API server listening on ${host ?? 'all addresses'}, port ${port}`);
});

// Renewal reminders: checked shortly after start and then every six hours. Each office is
// reminded once per end date, so restarts and overlapping runs do not send duplicates.
async function remindExpiringSubscriptions() {
  try {
    await sendSubscriptionReminders({ notify });
  } catch (error) {
    console.error('Subscription reminders could not be sent.', { name: error?.name ?? 'Error' });
  }
}
setTimeout(remindExpiringSubscriptions, 60_000).unref();
setInterval(remindExpiringSubscriptions, REMINDER_INTERVAL_MS).unref();
