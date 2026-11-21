// ICS_UID_DOMAIN (спецификация #9, US-10): домен сервиса в UID события
// («id брони @ домен сервиса»). Переменная необязательная — дефолт
// book-a-call.local, поэтому текущий деплой не требует новых переменных
// (ADR-0007). Читается при каждом вызове, чтобы тесты могли подменять env
// (паттерн getAppTz).

import { DEFAULT_UID_DOMAIN } from '@/domain/bookings/ics';

export function getIcsUidDomain(): string {
  return process.env.ICS_UID_DOMAIN?.trim() || DEFAULT_UID_DOMAIN;
}
