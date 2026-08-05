import { readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
for (const ext of ['.d.ts', '.d.cts']) {
  const hashed = readdirSync(dist).find((f) => f.match(new RegExp(`^index-[A-Za-z0-9_-]+\\${ext}$`)));
  if (hashed) {
    const clean = `index${ext}`;
    copyFileSync(join(dist, hashed), join(dist, clean));
    console.log(`renamed ${hashed} -> ${clean}`);
  }
}
