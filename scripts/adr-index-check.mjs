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

/** Разбор индекса ADR: блоки строк-таблиц — первая строка, номера ADR в
 * них и стартовая строка блока (1-based), чтобы уметь показывать место
 * разрыва. */
export function parseAdrIndex(readmeText) {
  const blocks = [];
  let current = [];
  let currentStart = 0;
  let firstText = '';
  let line = 0;
  for (const text of readmeText.split('\n')) {
    line += 1;
    if (/^\|/.test(text)) {
      if (current.length === 0) {
        currentStart = line;
        firstText = text;
      }
      const match = text.match(/^\|\s*ADR-(\d{4})\b/);
      current.push(match ? Number(match[1]) : null);
    } else if (current.length > 0) {
      blocks.push({ startLine: currentStart, firstLine: firstText, numbers: current });
      current = [];
    }
  }
  if (current.length > 0)
    blocks.push({ startLine: currentStart, firstLine: firstText, numbers: current });
  return blocks;
}

/** Блоки таблицы индекса: от блока-шапки («| ADR | Решение | …») до конца.
 * Любой блок после шапки — пустая строка ВНУТРИ индекса, включая разрыв
 * сразу после разделителя шапки (замечание 1 авторевью PR #26: шапка и
 * строки данных образуют один блок строк-таблицы). */
export function indexBlocks(readmeText) {
  const blocks = parseAdrIndex(readmeText);
  const headerIndex = blocks.findIndex((block) => /^\|\s*ADR\s+\|/.test(block.firstLine));
  return headerIndex === -1 ? null : blocks.slice(headerIndex);
}

/** Строки разрывов: старт последующих блоков индекса — перед каждой
 * стоит пустая строка. */
export function findBreakLines(readmeText) {
  const index = indexBlocks(readmeText);
  return index ? index.slice(1).map((block) => block.startLine) : [];
}

/** Русская плюрализация для сообщения линтера (тот же класс форм, что и
 * в текстах приложения — замечание 3 авторевью PR #26). */
export function pluralRuTables(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'таблицу';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'таблицы';
  return 'таблиц';
}

/** Проверка целостности индекса: один блок, полнота и порядок номеров. */
export function checkAdrIndex(readmeText, fileNumbers) {
  const problems = [];
  const index = indexBlocks(readmeText);
  if (!index) {
    return { ok: false, problems: ['шапка таблицы индекса («| ADR | Решение | …») не найдена'] };
  }
  const rows = index
    .map((block) => block.numbers)
    .flat()
    .filter((n) => n !== null);

  const breakLines = findBreakLines(readmeText);
  if (breakLines.length > 0) {
    const where =
      breakLines.length === 1
        ? `разрыв перед строкой ${breakLines[0]}`
        : `разрывы перед строками ${breakLines.join(', ')}`;
    problems.push(
      `строки ADR-индекса разорваны на ${index.length} ${pluralRuTables(index.length)} (${where}) — внутри индекса не должно быть пустых строк`,
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
