// Типы для scripts/adr-index-check.mjs (юнит-тесты импортируют чистую
// логику; сам скрипт — plain JS, линтер запускает его «node …»).

export interface AdrIndexBlock {
  startLine: number;
  firstLine: string;
  numbers: (number | null)[];
}

export function parseAdrIndex(readmeText: string): AdrIndexBlock[];

export function indexBlocks(readmeText: string): AdrIndexBlock[] | null;

export function findBreakLines(readmeText: string): number[];

export function pluralRuTables(n: number): string;

export function checkAdrIndex(
  readmeText: string,
  fileNumbers: number[],
): { ok: boolean; problems: string[] };
