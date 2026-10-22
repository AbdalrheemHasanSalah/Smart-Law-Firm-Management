export function notFoundHandler(_request, response) {
  response.status(404).json({ error: 'Route not found' });
}

export function errorHandler(error, _request, response, _next) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  console.error('Request failed', {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    status,
    code: typeof error?.code === 'string' ? error.code : undefined,
  });
  response.status(status).json({
    error: status >= 500 ? 'Internal server error' : error.message,
  });
}
