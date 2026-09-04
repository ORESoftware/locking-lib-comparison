import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadCatalog,
  renderCatalogMarkdown,
  validateCatalog,
} from '../src/catalog.mjs';

test('catalog contains every live-mutex* repository and Fiducia comparison target', async () => {
  const catalog = await loadCatalog();
  const liveMutexProjects = catalog.projects.filter(({ repository }) =>
    repository.startsWith('ORESoftware/live-mutex'));

  assert.deepEqual(
    liveMutexProjects.map(({ repository }) => repository).toSorted(),
    [
      'ORESoftware/live-mutex',
      'ORESoftware/live-mutex-examples',
      'ORESoftware/live-mutex-mills.rs',
      'ORESoftware/live-mutex-rs',
      'ORESoftware/live-mutex.distributed',
    ],
  );
  assert.ok(catalog.projects.some(({ id }) => id === 'fiducia-node'));
  assert.ok(catalog.projects.some(({ id }) => id === 'fiducia-clients'));
});

test('catalog rejects short revisions and unknown benchmark adapters', async () => {
  const catalog = structuredClone(await loadCatalog());
  catalog.projects[0].revision = 'abc123';
  assert.throws(() => validateCatalog(catalog), /full 40-character commit SHA/);

  catalog.projects[0].revision = 'a'.repeat(40);
  catalog.projects[0].benchmarkAdapter = 'mystery';
  assert.throws(() => validateCatalog(catalog), /benchmarkAdapter is unknown/);
});

test('markdown renderer produces one well-formed row per project', async () => {
  const catalog = await loadCatalog();
  const markdown = renderCatalogMarkdown(catalog);
  const rows = markdown.split('\n').filter((line) => /^\| \[/.test(line));

  assert.equal(rows.length, catalog.projects.length);
  assert.ok(rows.every((row) => row.endsWith(' |')));
  assert.ok(rows.every((row) => !row.endsWith(' | |')));
});
