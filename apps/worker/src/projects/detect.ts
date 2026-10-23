import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import type { Stack } from '@aios/contracts';

const MAX_MANIFEST_BYTES = 1024 * 1024;

async function readText(file: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return undefined;
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function parseJson(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const NODE_FRAMEWORKS: [dep: string, name: string][] = [
  ['next', 'next'],
  ['react', 'react'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['@angular/core', 'angular'],
  ['vite', 'vite'],
  ['@nestjs/core', 'nestjs'],
  ['fastify', 'fastify'],
  ['express', 'express'],
  ['electron', 'electron'],
  ['@tauri-apps/cli', 'tauri'],
  ['astro', 'astro'],
];

function depsOf(pkg: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const section = pkg[key];
    if (section && typeof section === 'object') {
      for (const name of Object.keys(section)) names.add(name);
    }
  }
  return names;
}

async function nodePackageManager(dir: string, pkg: Record<string, unknown>): Promise<string> {
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : '';
  if (declared && ['pnpm', 'yarn', 'npm', 'bun'].includes(declared)) return declared;
  if (await exists(nodePath.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(nodePath.join(dir, 'yarn.lock'))) return 'yarn';
  if (
    (await exists(nodePath.join(dir, 'bun.lock'))) ||
    (await exists(nodePath.join(dir, 'bun.lockb')))
  )
    return 'bun';
  return 'npm';
}

function pushUnique(list: string[], ...items: string[]): void {
  for (const item of items) if (!list.includes(item)) list.push(item);
}

/**
 * Menebak stack project dari berkas manifes di folder utamanya (tidak menjalankan apa pun, hanya membaca).
 * `devCommand` berupa array argumen, bukan string, supaya tidak pernah lewat shell.
 */
export async function detectStack(dir: string): Promise<Stack> {
  const languages: string[] = [];
  const frameworks: string[] = [];
  let packageManager: string | undefined;
  let devCommand: string[] | undefined;
  const at = (name: string) => nodePath.join(dir, name);

  const pkg = parseJson(await readText(at('package.json')));
  if (pkg) {
    const deps = depsOf(pkg);
    pushUnique(languages, 'javascript');
    if ((await exists(at('tsconfig.json'))) || deps.has('typescript'))
      pushUnique(languages, 'typescript');
    for (const [dep, name] of NODE_FRAMEWORKS) if (deps.has(dep)) pushUnique(frameworks, name);
    packageManager = await nodePackageManager(dir, pkg);
    const scripts = pkg.scripts;
    if (scripts && typeof scripts === 'object') {
      const names = Object.keys(scripts);
      const script = ['dev', 'start'].find((s) => names.includes(s));
      if (script) devCommand = [packageManager, 'run', script];
    }
  }

  const pyproject = await readText(at('pyproject.toml'));
  const requirements = await readText(at('requirements.txt'));
  if (pyproject !== undefined || requirements !== undefined || (await exists(at('setup.py')))) {
    pushUnique(languages, 'python');
    const text = `${pyproject ?? ''}\n${requirements ?? ''}`.toLowerCase();
    for (const name of ['django', 'fastapi', 'flask'])
      if (text.includes(name)) pushUnique(frameworks, name);
    packageManager ??= pyproject?.includes('[tool.poetry]')
      ? 'poetry'
      : (await exists(at('uv.lock')))
        ? 'uv'
        : 'pip';
  }

  const gradle = [
    await readText(at('build.gradle.kts')),
    await readText(at('build.gradle')),
    await readText(at('settings.gradle.kts')),
    await readText(at('settings.gradle')),
  ].filter((text): text is string => text !== undefined);
  if (gradle.length > 0) {
    const joined = gradle.join('\n');
    pushUnique(
      languages,
      /kotlin/i.test(joined) || (await exists(at('build.gradle.kts'))) ? 'kotlin' : 'java',
    );
    if (joined.includes('com.android')) pushUnique(frameworks, 'android');
    packageManager ??= 'gradle';
  }

  const cargo = await readText(at('Cargo.toml'));
  if (cargo !== undefined) {
    pushUnique(languages, 'rust');
    if (cargo.includes('tauri')) pushUnique(frameworks, 'tauri');
    packageManager ??= 'cargo';
    devCommand ??= ['cargo', 'run'];
  }

  if (await exists(at('go.mod'))) {
    pushUnique(languages, 'go');
    packageManager ??= 'go';
  }
  if (await exists(at('pom.xml'))) {
    pushUnique(languages, 'java');
    packageManager ??= 'maven';
  }
  if (await exists(at('composer.json'))) {
    pushUnique(languages, 'php');
    packageManager ??= 'composer';
  }
  if (await exists(at('Gemfile'))) {
    pushUnique(languages, 'ruby');
    packageManager ??= 'bundler';
  }
  if (await exists(at('pubspec.yaml'))) {
    pushUnique(languages, 'dart');
    pushUnique(frameworks, 'flutter');
    packageManager ??= 'pub';
  }
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  if (entries.some((e) => e.endsWith('.csproj') || e.endsWith('.sln'))) {
    pushUnique(languages, 'csharp');
    packageManager ??= 'dotnet';
  }

  return {
    languages,
    frameworks,
    ...(packageManager ? { packageManager } : {}),
    ...(devCommand ? { devCommand } : {}),
  };
}
