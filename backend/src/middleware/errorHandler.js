export function notFoundHandler(_request, response) {
  response.status(404).json({ code: 'NOT_FOUND', error: 'Route not found' });
}

/**
 * `publicCode` is a stable machine-readable code the frontend translates. It is only set by
 * application code, so database or library error codes are never exposed to clients.
 */
export function errorHandler(error, _request, response, _next) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  console.error('Request failed', {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    status,
    code: typeof error?.code === 'string' ? error.code : undefined,
  });
  const body = {
    error: status >= 500 ? 'Internal server error' : error.message,
  };
  if (status < 500 && typeof error?.publicCode === 'string') {
    body.code = error.publicCode;
  }
  response.status(status).json(body);
}
