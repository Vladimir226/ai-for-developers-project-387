import { describe, expect, it } from 'vitest';
import { buildBookingIcs } from './ics';
import type { BookingRecord } from './bookings';

// Чистая сборка ICS (спецификация #9, US-8/US-10): фиксированные даты
// допустимы — функция детерминирована и «сейчас» не читает.

function makeBooking(overrides: Partial<BookingRecord> = {}): BookingRecord {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    eventType: {
      id: '99999999-8888-4777-8666-555555555555',
      title: 'Консультация',
      durationMinutes: 30,
    },
    startsAt: new Date('2026-03-16T09:00:00Z'),
    endsAt: new Date('2026-03-16T09:30:00Z'),
    bookerName: 'Анна',
    bookerContact: 'phone:+79160000000',
    comment: null,
    createdAt: new Date('2026-03-10T12:00:00Z'),
    ...overrides,
  };
}

/** Разворачивает свёрнутые строки (RFC 5545 §3.1): CRLF + пробел → склейка. */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '');
}

/** Значение свойства VEVENT из развёрнутого ICS. */
function property(ics: string, name: string): string {
  const line = unfold(ics)
    .split('\r\n')
    .find((candidate) => candidate.startsWith(`${name}:`));
  if (line === undefined) {
    throw new Error(`свойство ${name} не найдено`);
  }
  return line.slice(name.length + 1);
}

describe('buildBookingIcs', () => {
  it('собирает VCALENDAR с VEVENT: обвязка календаря, строки через CRLF', () => {
    const ics = buildBookingIcs(makeBooking());

    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('PRODID:-//Book-a-Call//RU');
    expect(lines).toContain('CALSCALE:GREGORIAN');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('END:VEVENT');
    // файл завершается END:VCALENDAR + финальный CRLF (пустой хвост сплита)
    expect(lines[lines.length - 2]).toBe('END:VCALENDAR');
    expect(lines[lines.length - 1]).toBe('');
    // голых LF без CR нет — разделитель строго CRLF (RFC 5545 §3.1)
    expect(ics).not.toMatch(/(?<!\r)\n/);
  });

  it('VEVENT отражает бронь: SUMMARY «тип — гость», DESCRIPTION — контакт', () => {
    const ics = buildBookingIcs(makeBooking());

    expect(property(ics, 'SUMMARY')).toBe('Консультация — Анна');
    expect(property(ics, 'DESCRIPTION')).toBe('phone:+79160000000');
  });

  it('время — базовый UTC-формат RFC 5545 YYYYMMDDTHHMMSSZ (ADR-0009)', () => {
    const ics = buildBookingIcs(
      makeBooking({
        startsAt: new Date('2026-03-16T09:00:00.123Z'),
        endsAt: new Date('2026-03-16T09:30:00.999Z'),
        createdAt: new Date('2026-03-10T12:34:56.000Z'),
      }),
    );

    expect(property(ics, 'DTSTART')).toBe('20260316T090000Z');
    expect(property(ics, 'DTEND')).toBe('20260316T093000Z');
    expect(property(ics, 'DTSTAMP')).toBe('20260310T123456Z'); // момент создания
    expect(property(ics, 'DTSTART')).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('UID стабилен: id брони + домен сервиса, не зависит от остальных полей', () => {
    const first = buildBookingIcs(makeBooking());
    const second = buildBookingIcs(makeBooking({ comment: 'заметка изменилась' }));

    const uid = property(first, 'UID');
    expect(uid).toBe('11111111-2222-4333-8444-555555555555@book-a-call.local');
    expect(property(second, 'UID')).toBe(uid); // US-10: повторное скачивание не плодит дубликаты
  });

  it('DESCRIPTION с заметкой: контакт, затем заметка через перевод строки', () => {
    const ics = buildBookingIcs(makeBooking({ comment: 'Позвонить в Telegram' }));

    expect(property(ics, 'DESCRIPTION')).toBe('phone:+79160000000\\nПозвонить в Telegram');
  });

  it('экранирует спецсимволы TEXT (US-8): запятые, переводы строк; кавычки проходят как есть', () => {
    const ics = buildBookingIcs(
      makeBooking({
        bookerName: 'Иван, Иванов; "Ваня"\\мл.',
        bookerContact: 'email:ivan,@example.com',
        comment: 'первая строка\nвторая, строка; слэш \\ здесь',
      }),
    );

    expect(property(ics, 'SUMMARY')).toBe('Консультация — Иван\\, Иванов\\; "Ваня"\\\\мл.');
    expect(property(ics, 'DESCRIPTION')).toBe(
      'email:ivan\\,@example.com\\nпервая строка\\nвторая\\, строка\\; слэш \\\\ здесь',
    );
  });

  it('свёртка длинных строк (RFC 5545 §3.1): физические строки ≤75 октет, развёртка восстанавливает значение', () => {
    const octets = (text: string): number => new TextEncoder().encode(text).length;
    const longName = 'Г'.repeat(60); // 120 октет — кириллица по два
    const longComment = 'з'.repeat(80); // 160 октет
    const ics = buildBookingIcs(makeBooking({ bookerName: longName, comment: longComment }));

    // каждая физическая строка (без CRLF) укладывается в лимит октет
    for (const physical of ics.split('\r\n')) {
      expect(octets(physical)).toBeLessThanOrEqual(75);
    }
    // продолжения свёртки начинаются с пробела
    expect(ics.split('\r\n').filter((line) => line.startsWith(' ')).length).toBeGreaterThan(0);

    // развёртка восстанавливает полные значения — разрез не испортил символы
    expect(property(ics, 'SUMMARY')).toBe(`Консультация — ${longName}`);
    expect(property(ics, 'DESCRIPTION')).toBe(`phone:+79160000000\\n${longComment}`);
  });
});
