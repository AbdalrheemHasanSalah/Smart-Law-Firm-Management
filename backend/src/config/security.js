function parseUrl(value, settingName, requireOrigin = false) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${settingName} must be a valid URL.`);
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || (requireOrigin && parsed.pathname !== '/')
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(
      requireOrigin
        ? `${settingName} must be an HTTP(S) origin without credentials, path, query, or fragment.`
        : `${settingName} must be an HTTP(S) URL without credentials, query, or fragment.`
    );
  }

  return parsed;
}

export function getSecurityConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const configuredOriginProtection = env.ENFORCE_ORIGIN_PROTECTION;
  if (
    configuredOriginProtection !== undefined
    && configuredOriginProtection !== 'true'
    && configuredOriginProtection !== 'false'
  ) {
    throw new Error('ENFORCE_ORIGIN_PROTECTION must be true or false when configured.');
  }
  if (production && configuredOriginProtection === 'false') {
    throw new Error('Origin protection cannot be disabled in production.');
  }
  const enforceOriginProtection = production || configuredOriginProtection === 'true';
  const configuredBaseUrl = env.BETTER_AUTH_URL || env.APP_URL;

  if (production && !configuredBaseUrl) {
    throw new Error('BETTER_AUTH_URL or APP_URL must be configured in production.');
  }

  const baseUrl = configuredBaseUrl || 'http://localhost:3000';
  const parsedBaseUrl = parseUrl(baseUrl, 'BETTER_AUTH_URL');

  if (production && parsedBaseUrl.protocol !== 'https:') {
    throw new Error('BETTER_AUTH_URL must use HTTPS in production.');
  }

  const configuredOrigins = env.TRUSTED_FRONTEND_ORIGINS || env.FRONTEND_URL;

  if (production && !configuredOrigins) {
    throw new Error('TRUSTED_FRONTEND_ORIGINS or FRONTEND_URL must be configured in production.');
  }

  const trustedOrigins = (configuredOrigins || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const parsedOrigin = parseUrl(origin, 'TRUSTED_FRONTEND_ORIGINS', true);
      if (production && parsedOrigin.protocol !== 'https:') {
        throw new Error('Trusted frontend origins must use HTTPS in production.');
      }
      return parsedOrigin.origin;
    });

  if (trustedOrigins.length === 0) {
    throw new Error('At least one trusted frontend origin must be configured.');
  }

  return {
    production,
    enforceOriginProtection,
    baseUrl: parsedBaseUrl.toString().replace(/\/+$/, ''),
    trustedOrigins: [...new Set(trustedOrigins)],
  };
}
