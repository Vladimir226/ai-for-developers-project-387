#!/usr/bin/env node
// Предел запусков агента на один pull request (шаг 4). Бюджет проверяется
// ДО вызова модели: шаг воркфлоу opencode вызывает этот скрипт, и при
// исчерпании модель не запускается — отдельный шаг публикует отказ.
//
// Счётчик хранится в источниках, которые токен агента не может переписать:
//   1) допущенные запросы человека — комментарии доверенных авторов с /oc
//      или /opencode в обсуждении PR и в комментариях к строкам диффа
//      (комментарии ботов и посторонних не считаются — они и не допускаются);
//   2) повторные запуски — run_attempt прогонов воркфлоу opencode из
//      истории Actions: каждый re-run расходует попытку.
// Комментарий-отчёт бюджет не меняет: текст комментариев пишется, но
// считается только перечисленное выше.
//
// Использование: node scripts/agent-budget.mjs <pr-number> [limit]
// Окружение: GITHUB_REPOSITORY, GITHUB_TOKEN (actions: read, issues/pulls
// read). Пишет used/limit/allowed/head_sha в $GITHUB_OUTPUT.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];
export const AGENT_COMMANDS = ['/oc', '/opencode'];
export const DEFAULT_LIMIT = 3;

/** Комментарий — допущенный запрос человека к агенту (как if в opencode.yml). */
export function isAdmittedRequest(comment) {
  return (
    TRUSTED_ASSOCIATIONS.includes(comment.authorAssociation) &&
    comment.authorType !== 'Bot' &&
    AGENT_COMMANDS.some((command) => comment.body.includes(command))
  );
}

/** Прогоны воркфлоу opencode, относящиеся к PR: событие комментария и
 * совпадение с PR по заголовку прогона или ветке. run_attempt хранит
 * итоговое число попыток, поэтому попытка создаётся только повторами. */
export function matchingAgentRuns(runs, pr) {
  return runs.filter(
    (run) =>
      run.workflowName === 'opencode' &&
      (run.event === 'issue_comment' || run.event === 'pull_request_review_comment') &&
      (run.displayTitle === pr.title || run.headBranch === pr.headRef) &&
      Date.parse(run.createdAt) >= Date.parse(pr.createdAt),
  );
}

/** Бюджет PR: использовано и допущен ли новый вызов. */
export function computeBudget({
  pr,
  generalComments = [],
  inlineComments = [],
  runs = [],
  limit = DEFAULT_LIMIT,
}) {
  const requests =
    generalComments.filter(isAdmittedRequest).length +
    inlineComments.filter(isAdmittedRequest).length;
  const reruns = matchingAgentRuns(runs, pr).reduce(
    (sum, run) => sum + Math.max(0, run.runAttempt - 1),
    0,
  );
  const used = requests + reruns;
  return { used, limit, remaining: Math.max(0, limit - used), allowed: used < limit };
}

async function gh(path, headers, page = 1) {
  const response = await fetch(
    `https://api.github.com${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    {
      headers: { Accept: 'application/vnd.github+json', ...headers },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: GET ${path}`);
  }
  const body = await response.json();
  return Array.isArray(body) && body.length === 100
    ? [...body, ...(await gh(path, headers, page + 1))]
    : body;
}

/** Факты о PR из неизменяемых источников: комментарии и история Actions. */
export async function collectPrFacts({ repository, token, prNumber }) {
  const headers = { Authorization: `Bearer ${token}` };
  const pr = await gh(`/repos/${repository}/pulls/${prNumber}`, headers);
  const generalComments = (
    await gh(`/repos/${repository}/issues/${prNumber}/comments`, headers)
  ).map((comment) => ({
    authorAssociation: comment.author_association,
    authorType: comment.user.type,
    body: comment.body,
  }));
  const inlineComments = (await gh(`/repos/${repository}/pulls/${prNumber}/comments`, headers)).map(
    (comment) => ({
      authorAssociation: comment.author_association,
      authorType: comment.user.type,
      body: comment.body,
    }),
  );
  const runs = [
    ...(await gh(`/repos/${repository}/actions/runs?event=issue_comment`, headers)),
    ...(await gh(`/repos/${repository}/actions/runs?event=pull_request_review_comment`, headers)),
  ].map((run) => ({
    workflowName: run.name,
    event: run.event,
    displayTitle: run.display_title,
    headBranch: run.head_branch,
    createdAt: run.created_at,
    runAttempt: run.run_attempt,
  }));
  return {
    pr: {
      number: pr.number,
      title: pr.title,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      createdAt: pr.created_at,
    },
    generalComments,
    inlineComments,
    runs,
  };
}

async function main() {
  const prNumber = Number(process.argv[2]);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error('Использование: node scripts/agent-budget.mjs <pr-number> [limit]');
    process.exit(2);
  }
  const limit = Number(process.argv[3] ?? process.env.AGENT_BUDGET_PER_PR ?? DEFAULT_LIMIT);
  const { GITHUB_REPOSITORY: repository, GITHUB_TOKEN: token } = process.env;
  if (!repository || !token) {
    console.error('Нужны GITHUB_REPOSITORY и GITHUB_TOKEN');
    process.exit(2);
  }
  const facts = await collectPrFacts({ repository, token, prNumber });
  const budget = computeBudget({ ...facts, limit });
  const summary = {
    ...budget,
    pr: facts.pr.number,
    headSha: facts.pr.headSha,
  };
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `used=${budget.used}\nlimit=${budget.limit}\nallowed=${budget.allowed}\nhead_sha=${facts.pr.headSha}\n`,
    );
  }
  console.log(JSON.stringify(summary));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
