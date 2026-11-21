import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  cleanupSeededTypesAfterEach,
  firstDayWithSlots,
  openDay,
  seedAndTrack,
  slotTimeLabel,
  slotsSection,
  type SlotJson,
} from './helpers';

// Браузерный сценарий основного пути спецификации #22 (тикет #24):
// страница записи НЕ предлагает слоты ближе границы минимального запаса —
// каждый предложенный слот начинается не раньше now + 30 минут (включая
// уже начавшиеся: они до границы). Правило живёт на сервере (ADR-0004,
// тикет #23) — страница тонкая и строит календарь из ответа GET …/slots,
// поэтому проверяется именно этот ответ (каким строится страница) и его
// зеркало в кнопках-окнах открытого дня.
//
// Детерминизм по времени (заметки к #22): реальное now не контролируется,
// поэтому владелец через API ставит рабочие часы 00:00–24:00 на всю неделю
// (PUT — полная замена недели, D3) — в любой день недели СЕГОДНЯ есть
// старты сетки вокруг «сейчас», и в окне (now; now + 30м) всегда остаётся
// старт при длительности 30 минут: сценарий работает в любое время суток,
// а проверка границы «кусает», а не проходит вакуумно на пустом дне.
// Граница сравнивается с моментом ДО загрузки страницы: сервер фильтрует
// по своему now (он не раньше зафиксированного), так что каждый слот
// обязан быть ≥ before + 30м − δ (δ — запас на выполнение). После теста
// неделе владельца возвращаются сохранённые часы.

/** Константа правила «минимальный запас» (#22); в сценарии — независимо от домена. */
const LEAD_MS = 30 * 60 * 1000;

/** δ: запас на выполнение между фиксацией момента и ответом сервера. */
const EXECUTION_SLACK_MS = 2_000;

/**
 * Первый предложенный слот — рядом с границей, а не в другом конце недели:
 * сетка 00:00–24:00 даёт старт каждые 30 минут без «дыры» на стыке суток
 * (последний старт 23:30 заканчивается ровно в 24:00), худший разрыв от
 * границы до следующего старта — ровно шаг сетки (30 минут); запас —
 * 1,5 часа.
 */
const NEAR_BOUNDARY_MS = 90 * 60 * 1000;

/** День недели в JSON-форме контракта (GET/PUT /api/v1/working-hours). */
interface WorkingHoursDayJson {
  weekday: number;
  isDayOff: boolean;
  startMinutes?: number;
  endMinutes?: number;
}

/** Текущая неделя владельца (пустая таблица → дефолт D3 в ответе). */
async function getWorkingHours(request: APIRequestContext): Promise<WorkingHoursDayJson[]> {
  const response = await request.get('/api/v1/working-hours');
  expect(response.status(), 'GET рабочих часов').toBe(200);
  return ((await response.json()) as { days: WorkingHoursDayJson[] }).days;
}

/** Полная замена недели (D3): все 7 дней 00:00–24:00. */
async function putWorkingHours(
  request: APIRequestContext,
  days: WorkingHoursDayJson[],
): Promise<void> {
  const response = await request.put('/api/v1/working-hours', { data: { days } });
  expect(response.status(), 'PUT рабочих часов').toBe(200);
}

/**
 * Неделя 00:00–24:00 без выходных — «сейчас ± пара часов» покрыто в любой
 * день. 1440 минут (24:00), как в API-тестах запаса: сетка стартов
 * равномерна — каждые 30 минут до конца суток, последний старт 23:30
 * укладывается целиком (23:30 + 30 = 24:00); при 23:59 он бы выпадал.
 */
function aroundTheClockWeek(): WorkingHoursDayJson[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isDayOff: false,
    startMinutes: 0,
    endMinutes: 24 * 60,
  }));
}

// Уборка типов — общий хелпер (каскад D4 убирает и брони); часы недели
// возвращаются владельцу в afterEach describe ниже.
cleanupSeededTypesAfterEach();

test.describe('минимальный запас до звонка: список окон на странице записи', () => {
  let savedWeek: WorkingHoursDayJson[] = [];

  test.beforeEach(async ({ request }) => {
    savedWeek = await getWorkingHours(request);
    await putWorkingHours(request, aroundTheClockWeek());
  });

  test.afterEach(async ({ request }) => {
    await putWorkingHours(request, savedWeek);
  });

  test('гостю предлагаются только слоты не ближе 30 минут', async ({ page, request }) => {
    const type = await seedAndTrack(request, {
      title: 'Экспресс-созвон',
      description: 'Короткая встреча у владельца',
      durationMinutes: 30,
    });

    // Граница — ДО загрузки страницы: сервер фильтрует по своему моменту,
    // который не раньше зафиксированного
    const before = Date.now();

    // Страница строит календарь из ответа GET …/slots — ловим именно его
    const slotsLoaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes(`/api/v1/event-types/${type.id}/slots`),
    );
    await page.goto('/');
    await page
      .locator('section[aria-label="Виды брони"]')
      .getByRole('button', { name: /Экспресс-созвон/ })
      .click();
    const response = await slotsLoaded;
    expect(response.status(), 'GET слотов для календаря страницы').toBe(200);
    const slots = ((await response.json()) as { slots: SlotJson[] }).slots;

    // Список непуст: круглосуточная неделя даёт окна всегда (близкие слоты
    // есть — проверка не проходит вакуумно)
    expect(slots.length, 'предложенные слоты есть').toBeGreaterThan(0);

    // Основное утверждение: КАЖДЫЙ предложенный слот начинается не раньше
    // границы минимального запаса now + 30 минут (δ — на выполнение)
    const boundary = before + LEAD_MS - EXECUTION_SLACK_MS;
    for (const slot of slots) {
      expect(
        new Date(slot.startsAt).getTime(),
        `слот ${slot.startsAt} — не раньше границы запаса`,
      ).toBeGreaterThanOrEqual(boundary);
    }

    // Проверка «кусает»: ближайшее окно — за границей, но рядом с ней
    // (сетка даёт старт максимум через час после границы), а не в конце
    // 14-дневного окна
    expect(
      new Date(slots[0]!.startsAt).getTime(),
      'ближайшее окно — рядом с границей',
    ).toBeLessThanOrEqual(before + LEAD_MS + NEAR_BOUNDARY_MS);

    // Страница действительно предлагает эти окна: первый открытый день
    // календаря показывает ровно слоты ответа этого дня — ни близкого
    // лишнего, ни потерянного
    const day = firstDayWithSlots(slots);
    expect(day, 'в ответе есть день с окнами').not.toBeNull();
    await openDay(page, day!.dateKey);
    await expect(slotsSection(page).getByRole('button')).toHaveText(day!.slots.map(slotTimeLabel));
  });
});
