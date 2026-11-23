import app from './app.js';
import { notify } from './services/notificationService.js';
import { sendSubscriptionReminders } from './services/subscriptionService.js';

const port = Number(process.env.PORT) || 3000;
const REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000;

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
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
