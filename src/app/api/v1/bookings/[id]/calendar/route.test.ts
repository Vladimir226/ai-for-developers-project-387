import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db/prisma';
import { schemas } from '@/generated/zod';
import {
  deleteBooking,
  futureWorkingSlotStart,
  getBookingCalendar,
  postBooking,
  seedEventTypeViaApi,
  silenceRequestLogs,
} from '@/lib/testing/api';
import { clearTables, setupTestDatabase } from '@/lib/testing/test-db';

// Шов 1 (integration, ADR-004): файл календаря брони — .ics по RFC 5545
// (спецификация #9). Отмена брони удаляет строку — файл перестаёт
// существовать (404), отдельного статуса нет.

setupTestDatabase();

/** ISO → базовый UTC-формат RFC 5545; мс отбрасываются (дрожание Prisma). */
function isoToIcsUtc(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

describe('GET /api/v1/bookings/{id}/calendar', () => {
  beforeEach(async () => {
    silenceRequestLogs();
    await clearTables();
  });

  it('существующая бронь → 200 text/calendar с корректным VEVENT', async () => {
    const type = await seedEventTypeViaApi();
    const created = await postBooking({
      eventTypeId: type.id,
      startsAt: futureWorkingSlotStart().toISOString(), // пн 09:00 — валидный слот
      bookerName: 'Анна',
      bookerContact: 'phone:+79160000000',
      comment: 'Позвонить в Telegram',
    });
    const booking = schemas.BookingCreated.parse(await created.json());

    const response = await getBookingCalendar(booking.id);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('content-disposition')).toContain(`booking-${booking.id}.ics`);

    const ics = await response.text();
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain(`UID:${booking.id}@`); // стабильный UID из id брони (US-10)
    expect(ics).toContain(`SUMMARY:${type.title} — Анна`);
    expect(ics).toContain(`DESCRIPTION:${booking.bookerContact}\\n${booking.comment}`);
    expect(ics).toContain(`DTSTART:${isoToIcsUtc(booking.startsAt)}`);
    expect(ics).toContain(`DTEND:${isoToIcsUtc(booking.endsAt)}`);
    expect(ics).toContain(`DTSTAMP:${isoToIcsUtc(booking.createdAt)}`); // момент создания
  });

  it('домен UID события — из ICS_UID_DOMAIN, по умолчанию book-a-call.local', async () => {
    const type = await seedEventTypeViaApi();
    const created = await postBooking({
      eventTypeId: type.id,
      startsAt: futureWorkingSlotStart().toISOString(),
      bookerName: 'Анна',
      bookerContact: 'phone:+79160000000',
    });
    const booking = schemas.BookingCreated.parse(await created.json());

    // домен сервиса в UID настраивается окружением (US-10), чтение — на
    // каждый запрос: смена env видна без пересборки
    expect(await (await getBookingCalendar(booking.id)).text()).toContain(
      `UID:${booking.id}@book-a-call.local`,
    );

    vi.stubEnv('ICS_UID_DOMAIN', 'calls.example.com');
    try {
      const response = await getBookingCalendar(booking.id);
      expect(await response.text()).toContain(`UID:${booking.id}@calls.example.com`);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('неизвестный id → 404 NOT_FOUND в едином конверте', async () => {
    const response = await getBookingCalendar('00000000-0000-4000-8000-000000000000');

    expect(response.status).toBe(404);
    expect(schemas.ErrorEnvelope.parse(await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('отменённая бронь → 404 NOT_FOUND (отмена удаляет строку)', async () => {
    const type = await seedEventTypeViaApi();
    const created = await postBooking({
      eventTypeId: type.id,
      startsAt: futureWorkingSlotStart().toISOString(),
      bookerName: 'Анна',
      bookerContact: 'phone:+79160000000',
    });
    const booking = schemas.BookingCreated.parse(await created.json());

    expect((await deleteBooking(booking.id)).status).toBe(204);

    const response = await getBookingCalendar(booking.id);
    expect(response.status).toBe(404);
    expect(schemas.ErrorEnvelope.parse(await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('прошедшая бронь тоже отдаёт файл — эндпоинт отвечает для любой существующей', async () => {
    const type = await seedEventTypeViaApi();

    // прошедшая бронь сеется напрямую: продакшн-путь такое не создаёт
    const db = await getDb();
    const past = await db.booking.create({
      data: {
        eventTypeId: type.id,
        startsAt: new Date(Date.now() - 3 * 3600 * 1000),
        endsAt: new Date(Date.now() - 2.5 * 3600 * 1000),
        bookerName: 'Вчера',
        bookerContact: 'email:past@b.co',
      },
    });

    const response = await getBookingCalendar(past.id);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(await response.text()).toContain(`UID:${past.id}@`);
  });
});
