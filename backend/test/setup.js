import pg from 'pg';

process.env.NODE_ENV = 'test';
process.env.LAW_FIRM_UNIT_TEST_MODE = 'true';

function rejectPostgresConnection() {
  throw new Error('PostgreSQL connections are disabled during backend unit tests.');
}

pg.Client.prototype.connect = rejectPostgresConnection;
pg.Pool.prototype.connect = rejectPostgresConnection;
