import { findBookingById } from '@/domain/bookings/bookings';
import { buildBookingIcs } from '@/domain/bookings/ics';
import { jsonError } from '@/lib/http/json-error';
import { withRequestLogging } from '@/lib/http/with-request-logging';

// GET /api/v1/bookings/{id}/calendar (спецификация #9, ADR-0013): файл
// события .ics по RFC 5545 для импорта в календарь. Отвечает для любой
// существующей брони, включая прошедшую; отменённая (удалённая) — 404.

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withRequestLogging<RouteContext>(async (_request, { params }) => {
  const { id } = await params;

  const booking = await findBookingById(id);
  if (!booking) {
    return jsonError('NOT_FOUND', 404, 'Бронь не найдена');
  }

  return new Response(buildBookingIcs(booking), {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="booking-${booking.id}.ics"`,
    },
  });
});
