import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.LAW_FIRM_UNIT_TEST_MODE = 'true';

const [{ default: dotenv }, { default: pg }] = await Promise.all([
  import('dotenv'),
  import('pg'),
]);

const disableDotenvConfig = () => ({ parsed: {} });
Object.defineProperty(dotenv, 'config', {
  configurable: false,
  enumerable: true,
  value: disableDotenvConfig,
  writable: false,
});
if (dotenv.config !== disableDotenvConfig) {
  throw new Error('Unable to disable dotenv configuration for isolated case-assignment tests.');
}

function isEnvironmentFilePath(filePath) {
  let normalizedPath;
  if (filePath instanceof URL) {
    normalizedPath = fileURLToPath(filePath);
  } else if (Buffer.isBuffer(filePath)) {
    normalizedPath = filePath.toString();
  } else if (typeof filePath === 'string') {
    normalizedPath = filePath;
  } else {
    return false;
  }
  return /^\.env(?:\.|$)/i.test(path.basename(normalizedPath));
}

const originalReadFileSync = fs.readFileSync;
function guardedReadFileSync(filePath, ...args) {
  if (isEnvironmentFilePath(filePath)) {
    throw new Error('Environment-file reads are disabled in isolated case-assignment tests.');
  }
  return originalReadFileSync.call(this, filePath, ...args);
}
fs.readFileSync = guardedReadFileSync;
syncBuiltinESMExports();
if (fs.readFileSync !== guardedReadFileSync) {
  throw new Error('Unable to guard environment-file reads for isolated case-assignment tests.');
}

function blockPostgresMethod(target, methodName) {
  const blocked = function blockedPostgresOperation() {
    throw new Error('PostgreSQL access is disabled in isolated case-assignment tests.');
  };
  Object.defineProperty(target, methodName, {
    configurable: false,
    enumerable: true,
    value: blocked,
    writable: false,
  });
  if (target[methodName] !== blocked) {
    throw new Error(`Unable to block pg.${methodName} in isolated case-assignment tests.`);
  }
}

for (const databaseClass of [pg.Pool, pg.Client]) {
  if (!databaseClass?.prototype) {
    throw new Error('Unable to locate PostgreSQL pool and client prototypes for isolated tests.');
  }
  blockPostgresMethod(databaseClass.prototype, 'connect');
  blockPostgresMethod(databaseClass.prototype, 'query');
}
