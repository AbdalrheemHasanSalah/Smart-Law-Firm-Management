import dotenv from 'dotenv';
import pg from 'pg';

process.env.NODE_ENV = 'test';
process.env.LAW_FIRM_UNIT_TEST_MODE = 'true';

const disableDotenvConfig = () => ({ parsed: {} });
Object.defineProperty(dotenv, 'config', {
  configurable: false,
  enumerable: true,
  value: disableDotenvConfig,
  writable: false,
});
if (dotenv.config !== disableDotenvConfig) {
  throw new Error('Unable to disable dotenv configuration for isolated unit tests.');
}

function blockPostgresMethod(target, methodName, message) {
  const blocked = function blockedPostgresOperation() {
    throw new Error(message);
  };
  Object.defineProperty(target, methodName, {
    configurable: false,
    enumerable: true,
    value: blocked,
    writable: false,
  });
  if (target[methodName] !== blocked) {
    throw new Error(`Unable to block pg.${methodName} for isolated unit tests.`);
  }
}

for (const databaseClass of [pg.Pool, pg.Client]) {
  if (!databaseClass?.prototype) {
    throw new Error('Unable to locate PostgreSQL pool and client prototypes for isolated unit tests.');
  }
  blockPostgresMethod(
    databaseClass.prototype,
    'connect',
    'PostgreSQL connections are disabled during backend unit tests.'
  );
  blockPostgresMethod(
    databaseClass.prototype,
    'query',
    'PostgreSQL queries are disabled during backend unit tests.'
  );
}
