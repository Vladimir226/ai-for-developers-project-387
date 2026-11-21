import { describe, expect, it } from 'vitest';

import {
  checkAdrIndex,
  findBreakLines,
  indexBlocks,
  parseAdrIndex,
} from '../../scripts/adr-index-check';

// Защита целостности индекса ADR (#25, разбор ревью): пустая строка внутри
// таблицы рвала GFM-индекс, и дефект проходил все проверки CI. Чистая
// логика скрипта линтера проверяется здесь; сам линтер гоняет npm run lint.

const header = '| ADR      | Решение | Статус | Файл |\n| -------- | ------- | ------ | ---- |';

function row(number: number): string {
  const id = String(number).padStart(4, '0');
  return `| ADR-${id} | Решение ${id} | Accepted | ${id}-x.md |`;
}

function readme(rowsText: string): string {
  return `# ADR\n\n## Текущие решения\n\n${header}\n${rowsText}\n\n## Как добавить\n`;
}

describe('parseAdrIndex', () => {
  it('собирает непрерывные блоки строк-таблиц с номерами ADR и стартовой строкой', () => {
    const blocks = parseAdrIndex(readme(`${row(13)}\n${row(14)}`));
    expect(blocks).toHaveLength(1);
    // шапка и разделитель — строки таблицы без номера ADR (null); блок
    // начинается со строки 5 readme (1-based) и помнит свою первую строку
    expect(blocks[0]).toEqual({
      startLine: 5,
      firstLine: '| ADR      | Решение | Статус | Файл |',
      numbers: [null, null, 13, 14],
    });
  });
});

describe('findBreakLines', () => {
  it('целый индекс — разрывов нет', () => {
    expect(findBreakLines(readme(`${row(13)}\n${row(14)}`))).toEqual([]);
  });

  it('пустая строка между строками ADR — разрыв перед первой строкой следующего блока', () => {
    // readme(): строки 1–4 — заголовки, 5–6 — шапка, 7 — ADR-0013,
    // 8 — пустая, 9 — ADR-0014; разрыв = первая строка следующего блока
    expect(findBreakLines(readme(`${row(13)}\n\n${row(14)}`))).toEqual([9]);
  });

  it('регрессия авторевью PR #26: пустая строка после разделителя шапки — тоже разрыв', () => {
    // шапка (5–6) отделена пустой строкой от строк данных (8+): шапка и
    // данные образуют один блок строк-таблицы, разрыв ловится
    const broken = `# ADR\n\n## Текущие решения\n\n${header}\n\n${row(13)}\n${row(14)}\n`;
    expect(findBreakLines(broken)).toEqual([8]);
    expect(checkAdrIndex(broken, [13, 14]).ok).toBe(false);
  });

  it('два разрыва — по строке на каждый оторванный блок', () => {
    expect(findBreakLines(readme(`${row(13)}\n\n${row(14)}\n\n${row(15)}`))).toEqual([9, 11]);
  });
});

describe('checkAdrIndex', () => {
  it('основной сценарий: все файлы в одной таблице по порядку — цел', () => {
    const result = checkAdrIndex(readme(`${row(13)}\n${row(14)}`), [13, 14]);
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it('регрессия #25: строка, оторванная пустой строкой, — повреждение; формат сообщения запин', () => {
    const broken = readme(`${row(13)}\n\n${row(14)}`);
    const result = checkAdrIndex(broken, [13, 14]);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toBe(
      'строки ADR-индекса разорваны на 2 таблицы (разрыв перед строкой 9) — внутри индекса не должно быть пустых строк',
    );
  });

  it('несколько разрывов — все строки в сообщении, множественная форма запина', () => {
    const result = checkAdrIndex(readme(`${row(13)}\n\n${row(14)}\n\n${row(15)}`), [13, 14, 15]);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toBe(
      'строки ADR-индекса разорваны на 3 таблицы (разрывы перед строками 9, 11) — внутри индекса не должно быть пустых строк',
    );
  });

  it('регрессия авторевью PR #26 (замечание 3): форма «5 таблиц», не «5 таблицы»', () => {
    const text = readme(`${row(13)}\n\n${row(14)}\n\n${row(15)}\n\n${row(16)}\n\n${row(17)}`);
    const result = checkAdrIndex(text, [13, 14, 15, 16, 17]);
    expect(result.problems[0]).toContain('разорваны на 5 таблиц ');
  });

  it('отсутствующая шапка индекса — повреждение с явным сообщением', () => {
    const noHeader = `# ADR\n\n${row(13)}\n`;
    const result = checkAdrIndex(noHeader, [13]);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('шапка таблицы индекса');
  });

  it('отсутствующая строка и строка без файла — повреждения', () => {
    expect(checkAdrIndex(readme(row(13)), [13, 14]).problems[0]).toContain('строки в индексе нет');
    expect(checkAdrIndex(readme(`${row(13)}\n${row(14)}`), [13]).problems[0]).toContain(
      'без файла',
    );
  });

  it('нарушение порядка номеров — повреждение', () => {
    const result = checkAdrIndex(readme(`${row(14)}\n${row(13)}`), [13, 14]);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('не возрастают');
  });
});
