import 'dotenv/config';
import cors from 'cors';
import express from 'express';

import { authHandler } from './config/auth.js';
import { getSecurityConfig } from './config/security.js';
import apiRoutes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createOriginProtection } from './middleware/originProtection.js';
import { createRateLimit } from './middleware/rateLimit.js';
import { securityHeaders } from './middleware/securityHeaders.js';

const app = express();
const securityConfig = getSecurityConfig();

app.use(securityHeaders);
app.use(cors({
  origin(origin, callback) {
    callback(null, Boolean(origin && securityConfig.trustedOrigins.includes(origin)));
  },
  credentials: true,
}));

app.use('/api/auth', createRateLimit());
app.use('/api/auth/sign-in/email', createRateLimit({ maxRequests: 10 }));
app.use('/api/auth/sign-up/email', createRateLimit({ maxRequests: 10 }));
app.use('/api/auth/request-password-reset', createRateLimit({ maxRequests: 5 }));
app.use('/api/auth/reset-password', createRateLimit({ maxRequests: 10 }));
app.use(createOriginProtection({
  enforce: securityConfig.enforceOriginProtection,
  trustedOrigins: securityConfig.trustedOrigins,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.all('/api/auth/*', authHandler);
app.use('/api', apiRoutes);
app.get('/', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    service: 'smart-law-firm-backend',
    health: '/api/health',
  });
});
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
