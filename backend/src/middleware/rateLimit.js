import { isIP } from 'node:net';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_REQUESTS = 60;
const MAX_TRACKED_CLIENTS = 10000;
const OVERFLOW_CLIENT = Symbol('overflow-client');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The address a request is counted against. By default the TCP peer: caller-supplied headers are
 * never trusted. Behind a reverse proxy on the same machine (nginx in front of the API), every
 * request arrives from 127.0.0.1, so with TRUST_PROXY=loopback the X-Real-IP header is used, and
 * only when the request really came from the local proxy, which must overwrite that header.
 */
export function clientAddressOf(request, env = process.env) {
  const peer = request.socket?.remoteAddress || 'unknown';
  if (env.TRUST_PROXY !== 'loopback' || !LOOPBACK.has(peer)) return peer;
  const forwarded = request.headers?.['x-real-ip'];
  return typeof forwarded === 'string' && isIP(forwarded.trim()) ? forwarded.trim() : peer;
}

export function createRateLimit({
  windowMs = DEFAULT_WINDOW_MS,
  maxRequests = DEFAULT_MAX_REQUESTS,
  now = Date.now,
  env = process.env,
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
    const clientAddress = clientAddressOf(request, env);
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
