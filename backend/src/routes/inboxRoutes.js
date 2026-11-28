import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  clearNotifications,
  countUnreadMessages,
  getThread,
  listContacts,
  listNotifications,
  markNotificationRead,
  markNotificationsRead,
  sendMessage,
} from '../services/inboxService.js';
import { notifyLater } from '../services/notificationService.js';

const router = Router();
const everyone = ['admin', 'lawyer', 'assistant', 'client'];
router.use(['/notifications', '/messages'], requireAuth, requireRole(everyone));

const handle = (action, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await action(request));
  } catch (error) {
    return next(error);
  }
};

router.get('/notifications', handle((request) => listNotifications(request.user)));
router.post('/notifications/read', handle((request) => markNotificationsRead(request.user)));
router.post('/notifications/:notificationId/read', handle((request) => markNotificationRead(request.user, request.params.notificationId)));
router.delete('/notifications', handle((request) => clearNotifications(request.user)));

router.get('/messages/contacts', handle(async (request) => ({ contacts: await listContacts(request.user) })));
router.get('/messages/unread-count', handle(async (request) => ({ unread: await countUnreadMessages(request.user) })));
router.get('/messages/:userId', handle((request) => getThread(request.user, request.params.userId)));
router.post(
  '/messages/:userId',
  handle(async (request) => {
    const { message, contact } = await sendMessage(request.user, request.params.userId, request.body);
    notifyLater('message.received', {
      officeId: request.user.office_id,
      actorUserId: request.user.user_id,
      userId: contact.user_id,
      receiverRole: contact.role,
      senderName: request.user.full_name,
    });
    return { message };
  }, 201)
);

export default router;
