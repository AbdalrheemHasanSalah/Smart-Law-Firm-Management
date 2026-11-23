import { Router } from 'express';
import { getSubscriptionConfig } from '../config/subscription.js';
import { requireAuth, requirePlatformAdmin, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { notifyLater } from '../services/notificationService.js';
import {
  applyStripeEvent,
  createCheckout,
  getOfficeSubscription,
  listOfficePayments,
  listSubscriptions,
  recordManualPayment,
  verifyStripeSignature,
} from '../services/subscriptionService.js';

const router = Router();
const checkoutLimit = createRateLimit({ maxRequests: 10 });
// The office owner must reach the subscription page even when the subscription has lapsed.
const officeAdmin = [requireAuth, requireRole('admin', { allowLockedSubscription: true })];
const platformAdmin = [requireAuth, requirePlatformAdmin];

const handle = (action, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await action(request));
  } catch (error) {
    return next(error);
  }
};

router.get('/platform/subscriptions', ...platformAdmin, handle((request) => listSubscriptions(request.user)));
router.get(
  '/platform/offices/:officeId/payments',
  ...platformAdmin,
  handle((request) => listOfficePayments(request.user, request.params.officeId))
);
router.post(
  '/platform/offices/:officeId/payments',
  ...platformAdmin,
  handle(async (request) => {
    const result = await recordManualPayment(request.user, request.params.officeId, request.body);
    notifyLater('subscription.paid', {
      officeId: request.params.officeId,
      endsAt: result.subscription_ends_at,
      actorUserId: request.user.user_id,
    });
    return result;
  }, 201)
);

router.get('/offices/current/subscription', ...officeAdmin, handle((request) => getOfficeSubscription(request.user)));
router.post(
  '/offices/current/subscription/checkout',
  checkoutLimit,
  ...officeAdmin,
  handle((request) => createCheckout(request.user, request.body))
);

/**
 * Stripe calls this after a Checkout payment. It is mounted in app.js before the JSON parser and
 * the origin check (Stripe sends no Origin header), because the signature covers the raw body.
 */
export async function stripeWebhookController(request, response, next) {
  try {
    const { stripeWebhookSecret } = getSubscriptionConfig();
    if (!verifyStripeSignature(request.body, request.get('stripe-signature'), stripeWebhookSecret)) {
      return response.status(400).json({ code: 'VALIDATION', error: 'Invalid signature.' });
    }
    let event;
    try {
      event = JSON.parse(request.body.toString('utf8'));
    } catch {
      return response.status(400).json({ code: 'VALIDATION', error: 'Invalid payload.' });
    }
    const result = await applyStripeEvent(event);
    if (result.applied) {
      notifyLater('subscription.paid', { officeId: result.officeId, endsAt: result.endsAt, online: true });
    }
    return response.status(200).json({ received: true });
  } catch (error) {
    return next(error);
  }
}

export default router;
