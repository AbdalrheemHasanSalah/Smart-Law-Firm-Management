import { Router } from 'express';
import { getlaw } from '../controllers/lawController.js';

const router = Router();

router.get('/law', getlaw);

export default router;
