import assert from 'node:assert/strict';
import { test } from 'node:test';

import { errorHandler } from '../src/middleware/errorHandler.js';

test('error handler hides internal server error messages from responses', () => {
  const originalError = console.error;
  let responseStatus;
  let responseBody;
  console.error = () => {};
  try {
    errorHandler(
      Object.assign(new Error('database connection details'), { status: 500 }),
      {},
      {
        status(value) {
          responseStatus = value;
          return this;
        },
        json(value) {
          responseBody = value;
          return this;
        },
      },
      () => {}
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(responseStatus, 500);
  assert.deepEqual(responseBody, { error: 'Internal server error' });
});

test('error handler preserves client error messages', () => {
  let responseBody;
  errorHandler(
    Object.assign(new Error('Invalid request body.'), { status: 400 }),
    {},
    {
      status() {
        return this;
      },
      json(value) {
        responseBody = value;
        return this;
      },
    },
    () => {}
  );

  assert.deepEqual(responseBody, { error: 'Invalid request body.' });
});
