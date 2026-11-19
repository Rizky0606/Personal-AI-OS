import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isReadOnlyCommand } from './readonly.js';

let base: string;
let root: string;

beforeAll(async () => {
  base = await fs.realpath(await fs.mkdtemp(nodePath.join(tmpdir(), 'aios-readonly-')));
  root = nodePath.join(base, 'proj');
  await fs.mkdir(nodePath.join(root, 'src'), { recursive: true });
  await fs.writeFile(nodePath.join(root, 'src', 'a.ts'), 'x\n');
  await fs.writeFile(nodePath.join(base, 'rahasia.txt'), 'y\n');
  // Symlink di dalam folder run yang menunjuk ke luar: dibaca berarti keluar folder.
  await fs.symlink(nodePath.join(base, 'rahasia.txt'), nodePath.join(root, 'tautan.txt'));
  // Symlink folder yang menunjuk ke luar: `ls -L`/`-R` mengikutinya.
  await fs.symlink(base, nodePath.join(root, 'induk'));
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('isReadOnlyCommand', () => {
  it('perintah baca saja di folder run diizinkan otomatis', async () => {
    for (const cmd of [
      'git status',
      'git status --porcelain',
      'git diff',
      'git diff --stat HEAD',
      'git diff -- src/a.ts',
      'git log --oneline -5',
      'git log --format=%h',
      'git show HEAD',
      'ls',
      'ls -la src',
      'pwd',
      'command -v mypy',
      'cat src/a.ts',
      'head src/a.ts',
      'head -n 20 src/a.ts',
      'head -5 src/a.ts',
    ]) {
      expect(await isReadOnlyCommand(cmd, root, root), cmd).toBe(true);
    }
    // cwd subfolder di dalam folder run juga boleh.
    expect(await isReadOnlyCommand('cat a.ts', nodePath.join(root, 'src'), root)).toBe(true);
    // Path absolut yang tetap di dalam folder run juga boleh.
    expect(await isReadOnlyCommand(`cat ${nodePath.join(root, 'src', 'a.ts')}`, root, root)).toBe(
      true,
    );
  });

  it('yang lain tetap ditanyakan: metakarakter shell, opsi git berbahaya, path keluar folder, program lain', async () => {
    for (const cmd of [
      'git status; rm -rf .',
      'git status && npm test',
      'git log | head',
      'git diff > out.patch',
      'git diff $(echo x)',
      'git diff `x`',
      'git -c core.pager=x log',
      'git -C .. status',
      'git --git-dir=../x/.git log',
      'git diff --output=x.patch',
      'git diff --ext-diff',
      'git log --textconv -p',
      'git commit -m x',
      'git push',
      'git checkout main',
      'git show ../luar',
      'ls ..',
      'ls /etc',
      'ls ~',
      'ls src/*',
      'cat ../rahasia.txt',
      'cat /etc/passwd',
      'cat tautan.txt',
      'cat tidak-ada.txt',
      'cat',
      'cat -v src/a.ts',
      'head -c 10 src/a.ts',
      'command -v',
      'command -v a b',
      'command -p ls',
      'FOO=1 ls',
      'npm test',
      'rm src/a.ts',
      'cat "src/a.ts"',
      'ls\nrm x',
      'ls\rrm x',
      'ls\tsrc',
      'ls $HOME',
      'ls -L',
      'ls -RL',
      'ls --dereference src',
      'ls induk',
      'ls --color=auto',
      'head ../rahasia.txt',
      'head tautan.txt',
      'git diff --output x.patch',
      'git diff -O/etc/passwd',
      'git log :/',
      'git diff --no-index src/a.ts /etc/passwd',
    ]) {
      expect(await isReadOnlyCommand(cmd, root, root), cmd).toBe(false);
    }
  });

  it('cwd di luar folder run atau tidak diketahui: selalu ditanyakan', async () => {
    expect(await isReadOnlyCommand('git status', base, root)).toBe(false);
    expect(await isReadOnlyCommand('ls', '/tmp', root)).toBe(false);
    expect(await isReadOnlyCommand('git status', undefined, root)).toBe(false);
  });
});
