import { describe, expect, it } from 'vitest';

import { computeBudget, isAdmittedRequest, matchingAgentRuns } from '../../scripts/agent-budget';
import type { CommentFact, PrFact, RunFact } from '../../scripts/agent-budget';

// Предел запусков агента на PR (#19): чистая логика счётчика. Допущенный
// запрос — комментарий доверенного человека с командой агента; повторные
// запуски воркфлоу добираются по run_attempt из истории Actions.

const pr: PrFact = {
  number: 21,
  title: 'feat: минимальный запас до звонка (#20)',
  headRef: 't20-lead-time',
  headSha: 'abc123',
  createdAt: '2026-11-21T10:00:00Z',
};

function human(body: string): CommentFact {
  return { authorAssociation: 'OWNER', authorType: 'User', body };
}

function agentRun(overrides: Partial<RunFact> = {}): RunFact {
  return {
    workflowName: 'opencode',
    event: 'issue_comment',
    displayTitle: pr.title,
    headBranch: 'main',
    createdAt: '2026-11-21T11:00:00Z',
    runAttempt: 1,
    ...overrides,
  };
}

describe('isAdmittedRequest', () => {
  it('допускает команду доверенного человека', () => {
    expect(isAdmittedRequest(human('исправь это /oc'))).toBe(true);
    expect(isAdmittedRequest(human('/opencode объясни'))).toBe(true);
  });

  it('отбрасывает ботов, посторонних и текст без команды', () => {
    expect(isAdmittedRequest({ ...human('/oc'), authorType: 'Bot' })).toBe(false);
    expect(isAdmittedRequest({ ...human('/oc'), authorAssociation: 'NONE' })).toBe(false);
    expect(isAdmittedRequest(human('просто комментарий'))).toBe(false);
  });
});

describe('matchingAgentRuns', () => {
  it('относит к PR прогоны opencode по заголовку прогона или ветке', () => {
    const runs = [
      agentRun(),
      agentRun({ event: 'pull_request_review_comment' }),
      // чужой workflow и чужое событие не считаются
      agentRun({ workflowName: 'check', event: 'push' }),
      // прогон до открытия PR не считается
      agentRun({ createdAt: '2026-11-20T09:00:00Z' }),
      // совпадение по ветке PR вместо заголовка
      agentRun({ displayTitle: 'иначе titled', headBranch: pr.headRef }),
    ];
    expect(matchingAgentRuns(runs, pr)).toHaveLength(3);
  });
});

describe('computeBudget', () => {
  it('основной сценарий: запросы ниже предела — вызов допускается', () => {
    const budget = computeBudget({
      pr,
      generalComments: [human('/oc 1'), human('/oc 2')],
      inlineComments: [human('/oc 3')],
      runs: [agentRun()],
      limit: 3,
    });
    expect(budget).toMatchObject({ used: 3, remaining: 0, allowed: false });
  });

  it('негативный сценарий: четвёртый запрос отклоняется', () => {
    const budget = computeBudget({
      pr,
      generalComments: [human('/oc 1'), human('/oc 2'), human('без команды'), human('/oc 4')],
      limit: 3,
    });
    expect(budget).toMatchObject({ used: 3, allowed: false });
  });

  it('re-run расходует попытку: run_attempt добавляется к запросам', () => {
    const budget = computeBudget({
      pr,
      generalComments: [human('/oc 1')],
      runs: [agentRun({ runAttempt: 2 })],
      limit: 3,
    });
    expect(budget.used).toBe(2);
    expect(budget.allowed).toBe(true);
  });

  it('отменённый и застрявший прогоны не добавляют попыток сверх комментариев', () => {
    const budget = computeBudget({
      pr,
      generalComments: [human('/oc 1')],
      runs: [agentRun({ runAttempt: 1 }), agentRun({ event: 'pull_request_review_comment' })],
      limit: 3,
    });
    expect(budget.used).toBe(1);
  });
});
