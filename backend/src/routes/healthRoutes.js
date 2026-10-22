import { Router } from 'express';

const router = Router();

router.get('/health', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    service: 'smart-law-firm-backend',
    auth: 'better-auth',
  });
});

export default router;
