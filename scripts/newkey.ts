/**
 * Generate a fresh testnet keypair and write it into .env (gitignored).
 * Prints the ADDRESS only — the private key is never echoed to the terminal,
 * so it does not land in scrollback or shell history.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync, copyFileSync, chmodSync } from "node:fs";

const ENV = ".env";
if (!existsSync(ENV)) copyFileSync(".env.example", ENV);

const existing = readFileSync(ENV, "utf8");
const current = /^PRIVATE_KEY=(.+)$/m.exec(existing)?.[1]?.trim();
if (current) {
  const addr = privateKeyToAccount(current as `0x${string}`).address;
  console.log(`.env already holds a key for ${addr}`);
  console.log("Refusing to overwrite. Clear PRIVATE_KEY by hand if you want a new one.");
  process.exit(0);
}

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);
const next = existing.match(/^PRIVATE_KEY=.*$/m)
  ? existing.replace(/^PRIVATE_KEY=.*$/m, `PRIVATE_KEY=${pk}`)
  : `${existing.trimEnd()}\nPRIVATE_KEY=${pk}\n`;
writeFileSync(ENV, next);
// `mode` on writeFileSync only applies when the file is CREATED, and .env already
// exists by this point (copied from .env.example above). Set it explicitly.
chmodSync(ENV, 0o600);

console.log(`New testnet keypair written to .env (chmod 600, gitignored).\n`);
console.log(`  address  ${account.address}\n`);
console.log(`Fund this address with STT, then run: npm run fund`);
