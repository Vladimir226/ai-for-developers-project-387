import { afterEach, describe, expect, it, vi } from 'vitest';
import { getIcsUidDomain } from './ics-uid-domain';

// ICS_UID_DOMAIN (спецификация #9, US-10): домен сервиса в UID события
// («id брони @ домен сервиса»). Переменная необязательная — дефолт
// book-a-call.local, поэтому текущий деплой не требует новых переменных
// (ADR-0007). Читается при каждом вызове — как getAppTz, чтобы тесты могли
// подменять env.

describe('getIcsUidDomain', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('дефолт — book-a-call.local: без переменной поведение прежнее', () => {
    vi.stubEnv('ICS_UID_DOMAIN', '');

    expect(getIcsUidDomain()).toBe('book-a-call.local');
  });

  it('домен подменяется окружением', () => {
    vi.stubEnv('ICS_UID_DOMAIN', 'calls.example.com');

    expect(getIcsUidDomain()).toBe('calls.example.com');
  });
});
