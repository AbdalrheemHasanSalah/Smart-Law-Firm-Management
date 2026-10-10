export function notFoundHandler(_request, response) {
  response.status(404).json({ error: 'Route not found' });
}

export function errorHandler(error, _request, response, _next) {
  console.error(error);
  response.status(error.status || 500).json({
    error: error.status ? error.message : 'Internal server error',
  });
}
