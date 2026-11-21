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

export function buildBookingIcs(booking: BookingRecord): string {
  const summary = `${booking.eventType.title} — ${booking.bookerName}`;
  const description =
    booking.comment === null
      ? booking.bookerContact
      : `${booking.bookerContact}\n${booking.comment}`;

  return [
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
    '',
  ].join('\r\n');
}
