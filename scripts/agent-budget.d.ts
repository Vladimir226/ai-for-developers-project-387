// Типы для scripts/agent-budget.mjs (юнит-тесты импортируют чистую логику;
// сам скрипт остаётся plain-JS — воркфлоу запускает его «node …» без сборки).

export interface CommentFact {
  authorAssociation: string;
  authorType: string;
  body: string;
}

export interface RunFact {
  workflowName: string;
  event: string;
  displayTitle: string;
  headBranch: string;
  createdAt: string;
  runAttempt: number;
}

export interface PrFact {
  number: number;
  title: string;
  headRef: string;
  headSha: string;
  createdAt: string;
}

export function isAdmittedRequest(comment: CommentFact): boolean;

export function matchingAgentRuns(runs: RunFact[], pr: PrFact): RunFact[];

export function computeBudget(input: {
  pr: PrFact;
  generalComments?: CommentFact[];
  inlineComments?: CommentFact[];
  runs?: RunFact[];
  limit?: number;
}): { used: number; limit: number; remaining: number; allowed: boolean };
