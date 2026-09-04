#!/usr/bin/env node

import { loadCatalog, renderCatalogMarkdown } from '../src/catalog.mjs';

const catalog = await loadCatalog();
const format = process.argv.includes('--json') ? 'json' : 'markdown';

if (format === 'json') {
  process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
} else {
  process.stdout.write(renderCatalogMarkdown(catalog));
}
