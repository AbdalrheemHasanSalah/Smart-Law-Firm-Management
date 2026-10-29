import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import clientRoutes from './clientRoutes.js';
import caseRoutes from './caseRoutes.js';
import documentRoutes from './documentRoutes.js';
import contractRoutes from './contractRoutes.js';
import taskRoutes from './taskRoutes.js';
import lawRoutes from './lawRoutes.js';
import sessionRoutes from './sessionRoutes.js';
import userRoutes from './userRoutes.js';
import caseNoteRoutes from './caseNoteRoutes.js';
import officeRoutes from './officeRoutes.js';

const router = Router();

router.use(healthRoutes, sessionRoutes, lawRoutes, officeRoutes);
router.use('/clients', clientRoutes);
router.use('/cases', caseRoutes);
router.use('/documents', documentRoutes);
router.use('/contracts', contractRoutes);
router.use('/tasks', taskRoutes);
router.use('/users', userRoutes);
router.use('/notes', caseNoteRoutes);

export default router;
