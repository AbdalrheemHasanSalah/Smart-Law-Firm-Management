// Creates the platform administrator's account on a fresh server (no office needed) and grants it
// platform administration. The password is typed at the prompt and never shown, logged or stored
// anywhere but as the usual password hash. If the account already exists, only the grant is done.
//
// Usage (on the server, in an interactive terminal):
//   sudo -u qadiyati npm run platform-admin:create -- --email=admin@example.com [--name="Platform admin"]
import { auth } from '../src/config/auth.js';
import { pool } from '../src/config/db.js';

const argument = (name) => process.argv.slice(2).find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3).trim();
const email = argument('email')?.toLowerCase();
const name = argument('name') || 'مدير المنصّة';

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run platform-admin:create -- --email=<address> [--name=<name>]');
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('Run this in an interactive terminal: the password is typed at a hidden prompt.');
  process.exit(1);
}

/** Reads one line from the terminal without echoing it. */
function hiddenPrompt(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else value += character;
      }
    };
    stdin.on('data', onData);
  });
}

try {
  const existing = await pool.query('SELECT user_id FROM app_users WHERE lower(email) = $1', [email]);
  if (existing.rowCount) {
    console.log(`${email} already has an account; granting platform administration only.`);
  } else {
    const password = await hiddenPrompt(`Password for ${email} (at least 8 characters, hidden): `);
    const again = await hiddenPrompt('Type it again: ');
    if (password !== again) {
      console.error('The two passwords differ. Nothing was created.');
      process.exitCode = 1;
    } else if (password.length < 8) {
      console.error('The password must have at least 8 characters. Nothing was created.');
      process.exitCode = 1;
    } else {
      await auth.api.signUpEmail({ body: { email, password, name } });
      console.log(`Account created for ${email}.`);
    }
  }
  if (!process.exitCode) {
    const granted = await pool.query(
      `UPDATE app_users SET is_platform_admin = TRUE, updated_at = NOW()
        WHERE lower(email) = $1
        RETURNING email`,
      [email]
    );
    if (granted.rowCount) console.log(`Platform administration granted to ${granted.rows[0].email}.`);
    else {
      console.error('The account was not found after sign-up; nothing was granted.');
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error('Could not create the account:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
