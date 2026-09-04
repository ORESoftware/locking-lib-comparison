import { readFile } from 'node:fs/promises';

const REQUIRED_SUPPORT_FIELDS = [
  'mutex',
  'semaphore',
  'rwLock',
  'multiKey',
  'fencing',
  'automaticFailover',
  'durableState',
];

const BENCHMARK_ADAPTERS = new Set([
  'fiducia-http',
  'live-mutex-http',
  'live-mutex-mills-http',
  'live-mutex-rs-http',
]);

export const DEFAULT_CATALOG_URL = new URL('../data/projects.json', import.meta.url);

export async function loadCatalog(url = DEFAULT_CATALOG_URL) {
  const value = JSON.parse(await readFile(url, 'utf8'));
  validateCatalog(value);
  return value;
}

export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 1) {
    throw new Error('catalog.schemaVersion must be 1');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(catalog.observedAt ?? '')) {
    throw new Error('catalog.observedAt must use YYYY-MM-DD');
  }
  if (!Array.isArray(catalog.projects) || catalog.projects.length === 0) {
    throw new Error('catalog.projects must be a non-empty array');
  }

  const ids = new Set();
  const repositories = new Set();
  for (const project of catalog.projects) {
    for (const field of [
      'id',
      'repository',
      'url',
      'ref',
      'revision',
      'version',
      'role',
      'runtime',
      'architecture',
    ]) {
      if (typeof project[field] !== 'string' || project[field].length === 0) {
        throw new Error(`${project.id ?? '<unknown>'}.${field} must be a non-empty string`);
      }
    }
    if (ids.has(project.id)) {
      throw new Error(`duplicate project id: ${project.id}`);
    }
    if (repositories.has(project.repository)) {
      throw new Error(`duplicate repository: ${project.repository}`);
    }
    ids.add(project.id);
    repositories.add(project.repository);

    if (!/^[0-9a-f]{40}$/.test(project.revision)) {
      throw new Error(`${project.id}.revision must be a full 40-character commit SHA`);
    }
    if (!Array.isArray(project.transports) || project.transports.length === 0) {
      throw new Error(`${project.id}.transports must be a non-empty array`);
    }
    for (const field of REQUIRED_SUPPORT_FIELDS) {
      if (typeof project.support?.[field] !== 'string') {
        throw new Error(`${project.id}.support.${field} must be a string`);
      }
    }
    if (
      project.benchmarkAdapter !== null
      && !BENCHMARK_ADAPTERS.has(project.benchmarkAdapter)
    ) {
      throw new Error(`${project.id}.benchmarkAdapter is unknown`);
    }
  }

  const liveMutexRepositories = catalog.projects.filter(({ repository }) =>
    repository.startsWith('ORESoftware/live-mutex'));
  if (liveMutexRepositories.length !== 5) {
    throw new Error('catalog must contain all five ORESoftware live-mutex* repositories');
  }
  if (!ids.has('fiducia-node') || !ids.has('fiducia-clients')) {
    throw new Error('catalog must contain the Fiducia data plane and client suite');
  }

  return catalog;
}

export function renderCatalogMarkdown(catalog) {
  validateCatalog(catalog);
  const lines = [
    `Snapshot observed ${catalog.observedAt}. Revisions are pinned for reproducibility.`,
    '',
    '| Project | Role | Version / revision | Architecture | Failover | Transports |',
    '|---|---|---|---|---|---|',
  ];

  for (const project of catalog.projects) {
    const revision = project.revision.slice(0, 12);
    const cells = [
      `[${escapeCell(project.id)}](${project.url})`,
      escapeCell(project.role),
      `${escapeCell(project.version)} @ \`${revision}\` (\`${escapeCell(project.ref)}\`)`,
      escapeCell(project.architecture),
      escapeCell(project.support.automaticFailover),
      escapeCell(project.transports.join(', ')),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }

  return `${lines.join('\n')}\n`;
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
