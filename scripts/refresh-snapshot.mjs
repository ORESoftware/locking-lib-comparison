#!/usr/bin/env node

import process from 'node:process';
import { writeFile } from 'node:fs/promises';
import { loadCatalog, validateCatalog, DEFAULT_CATALOG_URL } from '../src/catalog.mjs';

const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--write')
    ? 'write'
    : 'print';
const token = process.env.GITHUB_TOKEN;
const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'locking-lib-comparison',
  'x-github-api-version': '2022-11-28',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};

const catalog = await loadCatalog();
const refreshed = structuredClone(catalog);
const changes = [];

for (const project of refreshed.projects) {
  const commit = await json(
    `https://api.github.com/repos/${project.repository}/commits/${encodeURIComponent(project.ref)}`,
    { headers },
  );
  if (project.revision !== commit.sha) {
    changes.push(`${project.id}: revision ${project.revision.slice(0, 12)} -> ${commit.sha.slice(0, 12)}`);
    project.revision = commit.sha;
  }

  const currentVersion = await resolveVersion(project);
  if (currentVersion && currentVersion !== project.version) {
    changes.push(`${project.id}: version ${project.version} -> ${currentVersion}`);
    project.version = currentVersion;
  }
}

refreshed.observedAt = new Date().toISOString().slice(0, 10);
validateCatalog(refreshed);

if (mode === 'check') {
  if (changes.length === 0) {
    process.stdout.write('Source snapshot is current.\n');
  } else {
    process.stderr.write(`Source snapshot is stale:\n- ${changes.join('\n- ')}\n`);
    process.exitCode = 1;
  }
} else if (mode === 'write') {
  await writeFile(DEFAULT_CATALOG_URL, `${JSON.stringify(refreshed, null, 2)}\n`);
  process.stdout.write(changes.length === 0
    ? 'Source snapshot already current.\n'
    : `Updated source snapshot:\n- ${changes.join('\n- ')}\n`);
} else {
  process.stdout.write(`${JSON.stringify(refreshed, null, 2)}\n`);
  if (changes.length > 0) {
    process.stderr.write(`Detected changes:\n- ${changes.join('\n- ')}\n`);
  }
}

async function resolveVersion(project) {
  if (project.versionSource === 'package.json') {
    const manifest = await raw(project, 'package.json');
    return JSON.parse(manifest).version;
  }
  if (project.versionSource === 'Cargo.toml') {
    const manifest = await raw(project, 'Cargo.toml');
    return manifest.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
  }
  if (project.versionSource === 'npm:live-mutex@latest') {
    const metadata = await json('https://registry.npmjs.org/live-mutex/latest');
    return metadata.version;
  }
  return undefined;
}

async function raw(project, path) {
  const url = `https://raw.githubusercontent.com/${project.repository}/${project.revision}/${path}`;
  const response = await fetch(url, { headers: { 'user-agent': headers['user-agent'] } });
  if (!response.ok) {
    throw new Error(`${response.status} while reading ${project.repository}/${path}`);
  }
  return response.text();
}

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} while reading ${url}`);
  }
  return response.json();
}
