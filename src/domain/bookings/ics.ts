// Доменный модуль bookings: сборка файла события iCalendar (RFC 5545) из
// брони — спецификация #9. Чистая функция без зависимости от HTTP и БД —
// тестируется unit-тестами (шов 3).

import type { BookingRecord } from './bookings';

/** Идентификатор продукта-генератора (RFC 5545 §3.7.3). */
const PRODID = '-//Book-a-Call//RU';

/** Домен сервиса в UID события — стабильный глобальный идентификатор (US-10). */
const UID_DOMAIN = 'book-a-call.local';

/** Дата в базовом UTC-формате RFC 5545: YYYYMMDDTHHMMSSZ (ADR-0009). */
export function icsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Экранирование значений TEXT по RFC 5545 §3.3.11. */
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Максимум октет в физической строке без свёртки (RFC 5545 §3.1). */
const LINE_LIMIT_OCTETS = 75;
/** Лимит продолжения: ведущий пробел свёртки входит в длину строки. */
const CONTINUATION_LIMIT_OCTETS = LINE_LIMIT_OCTETS - 1;

const encoder = new TextEncoder();

/** Длина строки в октетах UTF-8. */
function octets(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Свёртка длинных строк (RFC 5545 §3.1): CRLF + пробел перед продолжением.
 * Разрез идёт по границам символов — многобайтовая последовательность UTF-8
 * не рвётся посередине.
 */
export function foldLine(line: string): string {
  if (octets(line) <= LINE_LIMIT_OCTETS) return line;

  const chunks: string[] = [];
  let current = '';
  let currentOctets = 0;
  let limit = LINE_LIMIT_OCTETS;

  for (const char of line) {
    const charOctets = octets(char);
    if (currentOctets + charOctets > limit) {
      chunks.push(current);
      current = char;
      currentOctets = charOctets;
      limit = CONTINUATION_LIMIT_OCTETS;
    } else {
      current += char;
      currentOctets += charOctets;
    }
  }
  chunks.push(current);
  return chunks.join('\r\n ');
}

export function buildBookingIcs(booking: BookingRecord): string {
  const summary = `${booking.eventType.title} — ${booking.bookerName}`;
  const description =
    booking.comment === null
      ? booking.bookerContact
      : `${booking.bookerContact}\n${booking.comment}`;

  // Свёртка применяется к логической строке целиком — имя свойства
  // входит в лимит октет (RFC 5545 §3.1).
  return foldCalendar([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@${UID_DOMAIN}`,
    `DTSTAMP:${icsUtc(booking.createdAt)}`,
    `DTSTART:${icsUtc(booking.startsAt)}`,
    `DTEND:${icsUtc(booking.endsAt)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]);
}

/** Свёртывает логические строки и собирает файл с CRLF-разделителями. */
function foldCalendar(logicalLines: string[]): string {
  return `${logicalLines.map(foldLine).join('\r\n')}\r\n`;
}
