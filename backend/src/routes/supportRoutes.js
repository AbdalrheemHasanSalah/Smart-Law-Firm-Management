import { Router } from 'express';
import { optionalAuth, requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { notifyLater } from '../services/notificationService.js';
import {
  createSupportMessage,
  listSupportMessages,
  supportChat,
  updateSupportMessage,
} from '../services/supportService.js';

const router = Router();
// Open to visitors, so kept tight: each chat reply may be a paid model call.
const chatLimit = createRateLimit({ maxRequests: 30 });
const contactLimit = createRateLimit({ maxRequests: 5 });

const handle = (action, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await action(request));
  } catch (error) {
    return next(error);
  }
};

router.post('/support/chat', chatLimit, handle((request) => supportChat(request.body)));
router.post(
  '/support/messages',
  contactLimit,
  optionalAuth,
  handle(async (request) => {
    const result = await createSupportMessage(request.user ?? null, request.body);
    if (result.message_id) {
      notifyLater('support.message', { name: result.name, topic: result.topic, actorUserId: request.user?.user_id ?? null });
    }
    return { message_id: result.message_id, received: true };
  }, 201)
);

router.get('/platform/support/messages', requireAuth, requirePlatformAdmin, handle((request) => listSupportMessages(request.user, request.query)));
router.patch(
  '/platform/support/messages/:messageId',
  requireAuth,
  requirePlatformAdmin,
  handle((request) => updateSupportMessage(request.user, request.params.messageId, request.body))
);

export default router;
