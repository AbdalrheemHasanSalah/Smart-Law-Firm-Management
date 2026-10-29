// Grants platform administration to an existing account. There is intentionally no API for
// this: it is an operator action run against a local or explicitly configured database.
//
// Usage: npm run platform-admin:grant -- --email=owner@example.com
import { pool } from '../src/config/db.js';

const emailArgument = process.argv.slice(2).find((argument) => argument.startsWith('--email='));
const email = emailArgument?.slice('--email='.length).trim().toLowerCase();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run with NODE_ENV=production.');
  process.exit(1);
}
if (!email) {
  console.error('Usage: npm run platform-admin:grant -- --email=<account email>');
  process.exit(1);
}

try {
  const result = await pool.query(
    `UPDATE app_users SET is_platform_admin = TRUE, updated_at = NOW()
      WHERE lower(email) = $1
      RETURNING user_id, email`,
    [email]
  );
  if (!result.rowCount) {
    console.error(`No account found for ${email}. Sign up first, then run this again.`);
    process.exitCode = 1;
  } else {
    console.log(`Platform administration granted to ${result.rows[0].email}.`);
  }
} finally {
  await pool.end();
}
