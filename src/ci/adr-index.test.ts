import { describe, expect, it } from 'vitest';

import { checkAdrIndex, parseAdrIndex } from '../../scripts/adr-index-check';

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
  it('собирает непрерывные блоки строк-таблиц с номерами ADR', () => {
    const blocks = parseAdrIndex(readme(`${row(13)}\n${row(14)}`));
    expect(blocks).toHaveLength(1);
    // шапка и разделитель — строки таблицы без номера ADR (null)
    expect(blocks[0]).toEqual([null, null, 13, 14]);
  });
});

describe('checkAdrIndex', () => {
  it('основной сценарий: все файлы в одной таблице по порядку — цел', () => {
    const result = checkAdrIndex(readme(`${row(13)}\n${row(14)}`), [13, 14]);
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it('регрессия #25: строка, оторванная пустой строкей, — повреждение', () => {
    const broken = readme(`${row(13)}\n\n${row(14)}`);
    const result = checkAdrIndex(broken, [13, 14]);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('разорваны на 2 таблицы');
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
