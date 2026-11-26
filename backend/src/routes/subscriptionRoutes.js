import { Router } from 'express';
import { getSubscriptionConfig } from '../config/subscription.js';
import { requireAuth, requirePlatformAdmin, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { notifyLater } from '../services/notificationService.js';
import {
  applyStripeEvent,
  approvePaymentRequest,
  attachReceipt,
  cancelPaymentRequest,
  createCheckout,
  createPaymentRequest,
  getOfficeSubscription,
  getReceipt,
  listOfficePayments,
  listPaymentRequests,
  listSubscriptions,
  recordManualPayment,
  rejectPaymentRequest,
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

/* Payment requests: bank transfer, e-wallet or cash, reported by the office, reviewed by the platform. */
const requestLimit = createRateLimit({ maxRequests: 20 });

const sendReceipt = async (request, response, next) => {
  try {
    const { buffer, mime } = await getReceipt(request.user, request.params.paymentId);
    response.set({
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.status(200).end(buffer);
  } catch (error) {
    return next(error);
  }
};

router.get('/platform/payment-requests', ...platformAdmin, handle((request) => listPaymentRequests(request.user)));
router.get('/platform/payment-requests/:paymentId/receipt', ...platformAdmin, sendReceipt);
router.post(
  '/platform/payment-requests/:paymentId/approve',
  ...platformAdmin,
  handle(async (request) => {
    const result = await approvePaymentRequest(request.user, request.params.paymentId);
    notifyLater('subscription.paid', {
      officeId: result.office_id,
      endsAt: result.subscription_ends_at,
      actorUserId: request.user.user_id,
    });
    return result;
  })
);
router.post(
  '/platform/payment-requests/:paymentId/reject',
  ...platformAdmin,
  handle(async (request) => {
    const result = await rejectPaymentRequest(request.user, request.params.paymentId, request.body);
    notifyLater('subscription.request_rejected', { officeId: result.office_id, note: result.note, actorUserId: request.user.user_id });
    return result;
  })
);

router.post(
  '/offices/current/subscription/requests',
  requestLimit,
  ...officeAdmin,
  handle(async (request) => {
    const result = await createPaymentRequest(request.user, request.body);
    notifyLater('subscription.request_submitted', {
      officeId: request.user.office_id,
      method: result.request.method,
      amount: result.request.amount,
      currency: result.request.currency,
      actorUserId: request.user.user_id,
    });
    return result;
  }, 201)
);
router.put(
  '/offices/current/subscription/requests/:paymentId/receipt',
  requestLimit,
  ...officeAdmin,
  handle((request) => attachReceipt(request.user, request.params.paymentId, request))
);
router.get('/offices/current/subscription/requests/:paymentId/receipt', ...officeAdmin, sendReceipt);
router.post(
  '/offices/current/subscription/requests/:paymentId/cancel',
  ...officeAdmin,
  handle((request) => cancelPaymentRequest(request.user, request.params.paymentId))
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
