const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_REQUESTS = 60;
const MAX_TRACKED_CLIENTS = 10000;
const OVERFLOW_CLIENT = Symbol('overflow-client');

export function createRateLimit({
  windowMs = DEFAULT_WINDOW_MS,
  maxRequests = DEFAULT_MAX_REQUESTS,
  now = Date.now,
} = {}) {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError('windowMs must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
    throw new TypeError('maxRequests must be a positive safe integer.');
  }

  const clients = new Map();

  return (request, response, next) => {
    const currentTime = now();
    const clientAddress = request.socket?.remoteAddress || 'unknown';
    let clientKey = clientAddress;
    let entry = clients.get(clientKey);

    if (!entry || entry.resetAt <= currentTime) {
      if (!entry && clients.size >= MAX_TRACKED_CLIENTS - 1) {
        for (const [address, current] of clients) {
          if (current.resetAt <= currentTime) clients.delete(address);
        }
        if (clients.size >= MAX_TRACKED_CLIENTS - 1 && !clients.has(clientKey)) {
          clientKey = OVERFLOW_CLIENT;
        }
        entry = clients.get(clientKey);
      }
      if (!entry || entry.resetAt <= currentTime) {
        entry = { count: 0, resetAt: currentTime + windowMs };
        clients.set(clientKey, entry);
      }
    }

    entry.count += 1;
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1000));
    response.setHeader('RateLimit-Limit', String(maxRequests));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader('RateLimit-Reset', String(resetSeconds));

    if (entry.count > maxRequests) {
      response.setHeader('Retry-After', String(resetSeconds));
      response.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    next();
  };
}
