#!/usr/bin/env node
// Защита от повторения дефекта ревью PR #25 (шаг 4: «одна проблема →
// правило линтера»): пустая строка внутри индекса ADR отрывала строку
// ADR-0014 от GFM-таблицы — строка рендерилась абзацем с литеральными
// пайпами, а prettier и CI дефект не ловили, его увидели только глаза
// ревьюера. Проверка: каждый файл docs/adr/NNNN-*.md представлен строкой
// | NNNN | … и все строки индекса живут в ОДНОЙ непрерывной таблице
// (блоке строк, начинающихся с «|»), номера возрастают без пропусков.
//
// Запуск: node scripts/adr-index-check.mjs   (в составе npm run lint)

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');

/** Разбор индекса ADR: блоки строк-таблиц и номера в них. */
export function parseAdrIndex(readmeText) {
  const blocks = [];
  let current = [];
  for (const line of readmeText.split('\n')) {
    if (/^\|/.test(line)) {
      const match = line.match(/^\|\s*ADR-(\d{4})\b/);
      current.push(match ? Number(match[1]) : null);
    } else if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/** Проверка целостности индекса: один блок, полнота и порядок номеров. */
export function checkAdrIndex(readmeText, fileNumbers) {
  const problems = [];
  const blocks = parseAdrIndex(readmeText);
  const rowBlocks = blocks.filter((block) => block.some((n) => n !== null));
  const rows = rowBlocks.flat().filter((n) => n !== null);

  if (rowBlocks.length > 1) {
    problems.push(
      `строки ADR-индекса разорваны на ${rowBlocks.length} таблицы — внутри индекса не должно быть пустых строк`,
    );
  }
  for (const number of [...fileNumbers].sort((a, b) => a - b)) {
    if (!rows.includes(number)) {
      problems.push(
        `ADR-${String(number).padStart(4, '0')} есть файлом в docs/adr/, но строки в индексе нет`,
      );
    }
  }
  for (const number of rows) {
    if (!fileNumbers.includes(number)) {
      problems.push(`ADR-${String(number).padStart(4, '0')} в индексе без файла в docs/adr/`);
    }
  }
  const sorted = [...rows].every((number, i) => i === 0 || rows[i - 1] < number);
  if (!sorted) {
    problems.push('номера ADR в индексе не возрастают');
  }
  return { ok: problems.length === 0, problems };
}

function main() {
  const readmePath = join(repoRoot, 'docs/adr/README.md');
  const adrDir = join(repoRoot, 'docs/adr');
  const fileNumbers = readdirSync(adrDir)
    .map((name) => name.match(/^(\d{4})-.*\.md$/))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const result = checkAdrIndex(readFileSync(readmePath, 'utf8'), fileNumbers);
  if (!result.ok) {
    console.error(`docs/adr/README.md — индекс ADR повреждён:`);
    for (const problem of result.problems) console.error(`  — ${problem}`);
    process.exit(1);
  }
  console.log(
    `docs/adr/README.md — индекс ADR цел (${fileNumbers.length} решений одной таблицей).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
