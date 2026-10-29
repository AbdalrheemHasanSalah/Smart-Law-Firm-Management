import { Router } from 'express';
import { getlaw } from '../controllers/lawController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const adminRouter = Router();
const staffRouter = Router();
const clientRouter = Router();
const lawAccessRoles = ['admin', 'lawyer', 'assistant', 'client'];

adminRouter.use(requireAuth, requireRole(['admin']));
staffRouter.use(requireAuth, requireRole(['admin', 'lawyer', 'assistant']));
clientRouter.use(requireAuth, requireRole(lawAccessRoles));

adminRouter.get('/law', getlaw);
staffRouter.get('/law', getlaw);
clientRouter.get('/law', getlaw);

router.get('/law', requireAuth, requireRole(lawAccessRoles), getlaw);
router.use('/admin', adminRouter);
router.use('/staff', staffRouter);
router.use('/client', clientRouter);

export default router;
