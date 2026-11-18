import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { db } from './db.js';
import { passwordHash } from './security.js';
import { config } from './config.js';
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({
  input: process.stdin,
  output,
  terminal: Boolean(process.stdin.isTTY),
});
try {
  const email = z
    .string()
    .email()
    .max(254)
    .parse((await rl.question('Account email: ')).trim().toLowerCase());
  process.stdout.write('Password (at least 12 characters, input hidden): ');
  muted = true;
  const password = z
    .string()
    .min(12)
    .max(256)
    .parse(await rl.question(''));
  muted = false;
  process.stdout.write('\n');
  await db.user.create({ data: { email, passwordHash: passwordHash(password) } });
  console.log(`Account created. Sign in at ${config.WEB_ORIGIN}.`);
} catch {
  console.error(
    'Account not created. Use a valid email, a password of 12–256 characters and a unique account email; check database setup.',
  );
  process.exitCode = 1;
} finally {
  rl.close();
  await db.$disconnect();
}
