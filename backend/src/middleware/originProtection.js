const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createOriginProtection({ enforce, trustedOrigins }) {
  const trustedOriginSet = new Set(trustedOrigins);

  return (request, response, next) => {
    if (!enforce) {
      next();
      return;
    }

    const origin = request.get('origin');
    const fetchSite = request.get('sec-fetch-site');

    if (fetchSite?.toLowerCase() === 'cross-site') {
      response.status(403).json({ error: 'Cross-site requests are not allowed.' });
      return;
    }

    if (origin && !trustedOriginSet.has(origin)) {
      response.status(403).json({ error: 'Request origin is not allowed.' });
      return;
    }

    if (UNSAFE_METHODS.has(request.method.toUpperCase()) && !origin) {
      response.status(403).json({ error: 'An Origin header is required for this request.' });
      return;
    }

    next();
  };
}
