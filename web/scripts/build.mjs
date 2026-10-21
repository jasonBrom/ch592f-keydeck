import { cp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, relative, extname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'public'),
  output = resolve(root, 'dist');
// Only the named generated directory is removable; never follow user paths.
if (dirname(output) !== resolve(root) || relative(root, output) !== 'dist')
  throw Error('Unsafe build output');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
await writeFile(resolve(output, '.nojekyll'), '');

const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error('Symlink is not allowed in Pages artifact');
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(output);
const errors = [];
for (const path of files) {
  const extension = extname(path);
  if (!['.html', '.js', '.css'].includes(extension)) continue;
  const text = await readFile(path, 'utf8');
  let refs = [];
  if (extension === '.html')
    refs = [...text.matchAll(/(?:src|href|data-src)="([^"]+)"/g)].map((m) => m[1]);
  if (extension === '.js')
    refs = [
      ...text.matchAll(/(?:from\s*|import\s*)['"]([.][^'"]+)['"]/g),
      ...text.matchAll(/fetch\(['"]([.][^'"]+)['"]/g),
    ].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|data:|blob:|mailto:|#)/.test(ref)) continue;
    if (ref.startsWith('/')) {
      errors.push(`${relative(output, path)}: root-relative URL ${ref}`);
      continue;
    }
    const target = resolve(dirname(path), decodeURIComponent(ref.split(/[?#]/)[0]));
    if (relative(output, target).startsWith('..')) {
      errors.push(`${ref} escapes Pages root`);
      continue;
    }
    try {
      await stat(target);
    } catch {
      errors.push(`${relative(output, path)}: missing ${ref}`);
    }
  }
}
if (errors.length) throw Error(errors.join('\n'));
console.log(
  `Pages build: ${files.length} files; local links/imports verified; repository subpaths supported.`,
);
