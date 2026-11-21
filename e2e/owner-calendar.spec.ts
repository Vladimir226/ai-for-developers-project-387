import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  firstDayWithSlots,
  freeSlots,
  postBooking,
  seedEventType,
  upcomingBookings,
  type EventTypeJson,
} from './helpers';

// Браузерный сценарий шва 2 по спецификации #9 (тикет #11): владелец видит
// на карточке каждой предстоящей брони в разделе «Брони» (/admin) кнопку-
// ссылку «Добавить в календарь» — обычный <a> на эндпоинт файла, браузерное
// скачивание .ics без SDK-клиента (осознанное исключение из ADR-0004,
// ADR-0013). Скачивание проверяется паттерном Playwright «Downloads»:
// waitForEvent до клика, имя — из Content-Disposition эндпоинта (#10),
// содержимое — VEVENT этой брони (UID стабилен, DTSTART в UTC — ADR-0009).
// На публичной «Предстоящие записи» кнопки нет (out of scope #9).
//
// Брони сеются прямым POST (сервер настоящий, без подмен API — D7), уборка —
// как в booking-flow: afterEach удаляет сеянные типы, каскад D4 убирает брони,
// smoke видит на /admin чистое состояние.

const seededTypeIds = new Set<string>();

/** Сеет тип события и регистрирует его для уборки после теста. */
async function seedAndTrack(
  request: APIRequestContext,
  draft: { title: string; description?: string; durationMinutes: number },
): Promise<EventTypeJson> {
  const type = await seedEventType(request, draft);
  seededTypeIds.add(type.id);
  return type;
}

test.afterEach(async ({ request }) => {
  for (const id of seededTypeIds) {
    const response = await request.delete(`/api/v1/event-types/${id}`);
    expect(response.status(), `уборка сеянного типа ${id} (каскад D4)`).toBe(204);
  }
  seededTypeIds.clear();
});

test.describe('владелец: «Добавить в календарь» в разделе «Брони»', () => {
  test('кнопка на карточке каждой предстоящей брони ведёт на файл этой брони и скачивает .ics', async ({
    page,
    request,
  }) => {
    const type = await seedAndTrack(request, {
      title: 'Консультация 30',
      description: 'Разбор задачи с владельцем',
      durationMinutes: 30,
    });

    // Две брони одного типа: «каждая карточка» проверяется на обеих, а не на
    // одной. Цель — из ответа API: первый день, где есть два свободных окна
    // (основной сценарий booking-flow занимает слоты своего типа, но его
    // уборка уже отработала; порядок тестов не важен — workers: 1)
    const day = firstDayWithSlots(await freeSlots(request, type.id), 2);
    expect(day, 'в окне 14 дней у нового типа должны быть свободные дни').not.toBeNull();

    for (const [index, bookerName] of ['Николай', 'Ольга'].entries()) {
      const response = await postBooking(request, {
        eventTypeId: type.id,
        startsAt: day!.slots[index].startsAt,
        bookerName,
        bookerContact: `tel:+7 900 000-00-0${index}`,
      });
      expect(response.status(), `сеяние брони «${bookerName}»`).toBe(201);
    }

    // id броней — из списка владельца по API, не из головы; ключ брони —
    // startsAt занятого окна (ADR-0011: у слота нет идентификатора)
    const bookings = await upcomingBookings(request);
    const bySlot = new Map(bookings.map((booking) => [booking.startsAt, booking]));
    const nikolai = bySlot.get(day!.slots[0].startsAt);
    const olga = bySlot.get(day!.slots[1].startsAt);
    expect(nikolai, 'предстоящая бронь Николая в списке владельца').toBeDefined();
    expect(olga, 'предстоящая бронь Ольги в списке владельца').toBeDefined();

    // Раздел «Брони» владельца (#36): обе карточки предстоящих видны
    await page.goto('/admin');
    const nikolaiCard = page.locator('section[aria-label="Брони"] li', { hasText: 'Николай' });
    const olgaCard = page.locator('section[aria-label="Брони"] li', { hasText: 'Ольга' });
    await expect(nikolaiCard).toBeVisible();
    await expect(olgaCard).toBeVisible();

    // Кнопка на КАЖДОЙ карточке — обычная ссылка на файл своей брони (ADR-0013)
    await expect(nikolaiCard.getByRole('link', { name: 'Добавить в календарь' })).toHaveAttribute(
      'href',
      `/api/v1/bookings/${nikolai!.id}/calendar`,
    );
    await expect(olgaCard.getByRole('link', { name: 'Добавить в календарь' })).toHaveAttribute(
      'href',
      `/api/v1/bookings/${olga!.id}/calendar`,
    );

    // Владелец инициирует скачивание: событие ждём ДО клика (паттерн
    // «Downloads»), acceptDownloads включён по умолчанию
    const downloadPromise = page.waitForEvent('download');
    await nikolaiCard.getByRole('link', { name: 'Добавить в календарь' }).click();
    const download = await downloadPromise;

    // Имя файла — предложение из Content-Disposition эндпоинта (#10)
    expect(download.suggestedFilename()).toBe(`booking-${nikolai!.id}.ics`);

    // Содержимое — VEVENT этой брони: стабильный UID (US-10, повторное
    // скачивание не плодит дубли), интервал в базовом UTC-формате RFC 5545
    // (ADR-0009), заголовок «тип — гость» (US-2/3)
    const ics = await readFile((await download.path())!, 'utf8');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain(`UID:${nikolai!.id}@book-a-call.local`);
    expect(ics).toMatch(/^DTSTART:\d{8}T\d{6}Z$/m);
    expect(ics).toContain('SUMMARY:Консультация 30 — Николай');
    expect(ics).toContain(`DESCRIPTION:${nikolai!.bookerContact}`);

    // Публичная «Предстоящие записи» (ADR-0012): кнопки там нет (out of
    // scope #9) — раздел не расширялся
    await page.goto('/bookings');
    await expect(page.getByRole('link', { name: 'Добавить в календарь' })).toHaveCount(0);
  });
});
