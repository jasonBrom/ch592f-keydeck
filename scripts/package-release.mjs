import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(resolve(root, 'web/package.json'), 'utf8'));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
  throw new Error('Invalid firmware package version');
const output = resolve(root, `releases/${version}`),
  downloads = resolve(root, 'web/public/downloads');
await mkdir(output, { recursive: true });
await mkdir(downloads, { recursive: true });
const manifest = {
  version,
  sdkCommit: 'a46e0086f1ffb5e5502703970bff94888e67f4cb',
  toolchain: 'WCH MounRiver 1.91 / GCC 8.2.0',
  hardwareTested: false,
  variants: {},
};
for (const variant of ['haptic', 'no-haptic']) {
  const name = `KeyDeck-CH592F-${variant}`;
  const artifacts = [];
  for (const extension of ['hex', 'bin']) {
    const filename = `${name}.${extension}`,
      data = await readFile(resolve(root, `firmware/build/${variant}/${filename}`));
    await writeFile(resolve(output, filename), data);
    await writeFile(resolve(downloads, filename), data);
    artifacts.push({
      file: filename,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
  }
  manifest.variants[variant] = { haptics: variant === 'haptic', artifacts };
}
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await copyFile(resolve(output, 'manifest.json'), resolve(downloads, 'manifest.json'));
await copyFile(resolve(root, 'firmware/README.md'), resolve(downloads, 'firmware-guide.md'));
console.log('Packaged haptic + no-haptic HEX/BIN and SHA-256 manifest.');
