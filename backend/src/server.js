import app from './app.js';
import { notify } from './services/notificationService.js';
import { reminderConfig, runReminders } from './services/reminderService.js';
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

// Hearing, task, appointment and power-of-attorney reminders: checked every fifteen minutes.
// Each reminder is claimed in the database before it is sent, so none is sent twice.
const SCHEDULED_REMINDERS_MS = 15 * 60 * 1000;
reminderConfig(); // Fails at start, not hours later, when REMINDER_TIMEZONE or the hour is wrong.
async function sendScheduledReminders() {
  try {
    await runReminders();
  } catch (error) {
    console.error('Scheduled reminders could not be sent.', { name: error?.name ?? 'Error' });
  }
}
setTimeout(sendScheduledReminders, 90_000).unref();
setInterval(sendScheduledReminders, SCHEDULED_REMINDERS_MS).unref();
