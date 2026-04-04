import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const marker = join(__dirname, '..', '.safechain-setup-done');

// Check if SAFE_CHAIN_CI env var is set to true (used in Github CI)
const isSafeChainCi = process.env.SAFE_CHAIN_CI && process.env.SAFE_CHAIN_CI.toLowerCase() === 'true';

if (!existsSync(marker) && !isSafeChainCi) {
  console.log('🔒 Aikido Safe Chain setup marker not found. Installing SafeChain...');
  execSync('npm install -g @aikidosec/safe-chain@1.4.7 && safe-chain setup', {
    stdio: 'inherit'
  });
  writeFileSync(marker, 'done');
  console.log('✔ *******************************************************');
  console.log('✔ * ');
  console.log('✔ *  ‼️‼️‼️‼️‼️‼️‼️‼️ ATTENTION PLEASE ‼️‼️‼️‼️‼️‼️‼️‼️‼️ ');
  console.log('✔ *  Aikido Safe Chain been installed to detect malicious packages');
  console.log('✔ *  Malicious packages will NOT be allowed to be installed');
  console.log('✔ * ');
  console.log('✔ *            (👍≖‿‿≖)👍');
  console.log('✔ * ');
  console.log('✔ *  Please restart your terminal(close the terminal and reopen)'.toUpperCase());
  console.log('✔ *  APPLY  `npm install`  again.'.toUpperCase());
  console.log('✔ * ');
  console.log('✔ *******************************************************');
  process.exit(1);
} else {
  if (!isSafeChainCi) {
    console.log('✅ This project is protected by Aikido Safe Chain.');
  }
}
