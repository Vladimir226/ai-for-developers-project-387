// Типы для scripts/adr-index-check.mjs (юнит-тесты импортируют чистую
// логику; сам скрипт — plain JS, линтер запускает его «node …»).

export function parseAdrIndex(readmeText: string): (number | null)[][];

export function checkAdrIndex(
  readmeText: string,
  fileNumbers: number[],
): { ok: boolean; problems: string[] };
