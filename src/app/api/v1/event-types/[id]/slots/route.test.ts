import { beforeEach, describe, expect, it } from 'vitest';
import { schemas } from '@/generated/zod';
import {
  deleteBooking,
  futureMondayMidnight,
  getEventTypeSlots,
  postBooking,
  putWorkingHours,
  seedEventTypeViaApi,
  silenceRequestLogs,
  weekHours,
} from '@/lib/testing/api';
import { clearTables, setupTestDatabase } from '@/lib/testing/test-db';

// Шов 1 (integration, ADR-004): вычисляемые слоты GET /event-types/{id}/slots
// (ADR-0011). Генерация — окно × рабочие часы × шаг = длительности (D2/D3);
// занятость — наложение с бронями любых типов (D12). С #22 выдача зависит
// от «сейчас» — старты до границы минимального запаса не возвращаются,
// поэтому периоды строятся от будущего понедельника (72 часа вперёд):
// фиксированные календарные даты протухают.

setupTestDatabase();

describe('GET /api/v1/event-types/{id}/slots — минимальный запас до звонка (#22)', () => {
  beforeEach(async () => {
    silenceRequestLogs();
    await clearTables();
  });

  it('выдача не содержит стартов до границы запаса, включая уже начавшиеся', async () => {
    const type = await seedEventTypeViaApi({ durationMinutes: 30 });
    const put = await putWorkingHours({
      days: weekHours({ startMinutes: 0, endMinutes: 1440 }, []),
    });
    expect(put.status).toBe(200);

    // явный from в прошлом: кандидаты включают начавшиеся и близкие слоты —
    // гость их видеть не должен (правило одно для выдачи и брони, ADR-004)
    const now = Date.now();
    const boundary = now + 30 * 60 * 1000;
    const yesterday = new Date(now - 24 * 60 * 60 * 1000);

    const response = await getEventTypeSlots(type.id, `?from=${yesterday.toISOString()}`);
    expect(response.status).toBe(200);

    const body = schemas.SlotList.parse(await response.json());
    expect(body.slots.length).toBeGreaterThan(0);
    for (const slot of body.slots) {
      expect(new Date(slot.startsAt).getTime()).toBeGreaterThanOrEqual(boundary);
    }
  });
});

describe('GET /api/v1/event-types/{id}/slots', () => {
  beforeEach(async () => {
    silenceRequestLogs();
    await clearTables();
  });

  /** Полночь стены MSK ближайшего будущего понедельника (≥ 72 часов вперёд). */
  const monday = futureMondayMidnight();

  /** Мгновение стены MSK: dayOffset суток от понедельника + минуты дня. */
  const mskAt = (dayOffset: number, minutes: number) =>
    new Date(monday.getTime() + (dayOffset * 24 * 60 + minutes) * 60 * 1000);

  /** Конец воскресенья той же недели (23:59:59.999 стены MSK). */
  const sundayEnd = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

  const q = (from: Date, to: Date) =>
    `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;

  function slotStarts(id: string, query = ''): Promise<string[]> {
    return getEventTypeSlots(id, query)
      .then((response) => {
        expect(response.status).toBe(200);
        return response.json();
      })
      .then((body) => schemas.SlotList.parse(body).slots.map((slot) => slot.startsAt));
  }

  it('неизвестный тип → 404 NOT_FOUND', async () => {
    const response = await getEventTypeSlots('00000000-0000-4000-8000-000000000000');

    expect(response.status).toBe(404);
    expect(schemas.ErrorEnvelope.parse(await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('дефолт часов D3: слоты в Пн–Пт 09:00–18:00 MSK, выходные пусты, шаг = длительности', async () => {
    const type = await seedEventTypeViaApi({ durationMinutes: 60 });

    const starts = await slotStarts(type.id, q(monday, sundayEnd));

    // 5 рабочих дней × 9 стартов (09:00 … 17:00)
    expect(starts).toHaveLength(5 * 9);
    expect(starts[0]).toBe(mskAt(0, 9 * 60).toISOString());
    expect(starts.at(-1)).toBe(mskAt(4, 17 * 60).toISOString());

    const days = new Set(
      starts.map((start) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date(start)),
      ),
    );
    expect([...days].sort()).toEqual(
      [0, 1, 2, 3, 4].map((dayOffset) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(mskAt(dayOffset, 0)),
      ),
    );
  });

  it('шаг = длительности (D2): тип 120 минут — старты 09:00, 11:00, 13:00, 15:00', async () => {
    const type = await seedEventTypeViaApi({ durationMinutes: 120 });

    // to — полночь среды: среда в периоде, но её старты после to
    const starts = await slotStarts(type.id, q(monday, mskAt(2, 0)));

    expect(starts).toEqual(
      [0, 1].flatMap((dayOffset) =>
        [9, 11, 13, 15].map((hour) => mskAt(dayOffset, hour * 60).toISOString()),
      ),
    );
  });

  it('заданные часы: границы и выходные из PUT, а не дефолт', async () => {
    const type = await seedEventTypeViaApi({ durationMinutes: 30 });
    const put = await putWorkingHours({
      days: weekHours({ startMinutes: 10 * 60, endMinutes: 12 * 60 }, [1, 2, 3, 4, 5, 6]),
    });
    expect(put.status).toBe(200);

    const starts = await slotStarts(type.id, q(monday, sundayEnd));

    // работает только воскресенье: 10:00, 10:30, 11:00, 11:30
    expect(starts).toEqual(
      [10 * 60, 10 * 60 + 30, 11 * 60, 11 * 60 + 30].map((minutes) =>
        mskAt(6, minutes).toISOString(),
      ),
    );
  });

  it('все дни выходные → пустой список', async () => {
    const type = await seedEventTypeViaApi();
    await putWorkingHours({
      days: weekHours({ startMinutes: 540, endMinutes: 1080 }, [0, 1, 2, 3, 4, 5, 6]),
    });

    expect(await slotStarts(type.id, q(monday, sundayEnd))).toEqual([]);
  });

  it('from/to: дефолт — 14 дней от сейчас; невалидные значения → 422', async () => {
    const type = await seedEventTypeViaApi();

    const response = await getEventTypeSlots(type.id);
    expect(response.status).toBe(200);
    const body = schemas.SlotList.parse(await response.json());
    expect(body.slots.every((slot) => new Date(slot.startsAt) > new Date(Date.now() - 1000))).toBe(
      true,
    );

    const notIso = await getEventTypeSlots(type.id, '?from=завтра');
    expect(notIso.status).toBe(422);
    const bodyNotIso = schemas.ErrorEnvelope.parse(await notIso.json());
    expect(bodyNotIso.error.code).toBe('VALIDATION_ERROR');
    expect(bodyNotIso.error.details?.[0]?.field).toBe('from');

    const inverted = await getEventTypeSlots(type.id, q(sundayEnd, monday));
    expect(inverted.status).toBe(422);
    expect(schemas.ErrorEnvelope.parse(await inverted.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('бронь убирает слот из списка, отмена возвращает (включая брони других типов — D12)', async () => {
    const query = q(monday, new Date(monday.getTime() + 7 * 24 * 3600 * 1000));
    const type30 = await seedEventTypeViaApi({ durationMinutes: 30 });
    const type60 = await seedEventTypeViaApi({ durationMinutes: 60 });

    const nine = mskAt(0, 9 * 60); // 09:00 MSK
    const before = await slotStarts(type30.id, query);
    expect(before).toContain(nine.toISOString());
    const booked = await postBooking({
      eventTypeId: type60.id,
      startsAt: nine.toISOString(),
      bookerName: 'Анна',
      bookerContact: 'phone:+79160000000',
    });
    expect(booked.status).toBe(201);

    const during = await slotStarts(type30.id, query);
    expect(during).not.toContain(nine.toISOString());
    expect(during).not.toContain(new Date(nine.getTime() + 30 * 60 * 1000).toISOString());
    expect(during).toContain(new Date(nine.getTime() + 60 * 60 * 1000).toISOString()); // 10:00 свободно

    const booking = schemas.BookingCreated.parse(await booked.json());
    const cancelled = await deleteBooking(booking.id);
    expect(cancelled.status).toBe(204);

    expect(await slotStarts(type30.id, query)).toEqual(before);
  });
});
