import type { OrchestratorPlanTaskContent } from '../../../core/types';
import { isRecord } from '../../../utils/records';

export type OrchestratorTask = OrchestratorPlanTaskContent;

export interface OrchestratorPlan {
  type: 'parallel_worker_plan';
  tasks: OrchestratorTask[];
}

const MIN_ORCHESTRATOR_TASKS = 2;
const MAX_ORCHESTRATOR_TASKS = 5;

export function parseOrchestratorPlan(markdown: string): OrchestratorPlan | null {
  return findOrchestratorPlan(markdown)?.plan ?? null;
}

export function stripOrchestratorPlanPayload(markdown: string): string {
  const match = findOrchestratorPlan(markdown);
  if (!match) return markdown;

  return `${markdown.slice(0, match.start)}${markdown.slice(match.end)}`.trim();
}

function findOrchestratorPlan(
  markdown: string,
): { end: number; plan: OrchestratorPlan; start: number } | null {
  const fencePattern = /```([^\r\n]*)\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(markdown)) !== null) {
    const info = match[1].trim().toLowerCase();
    const language = info.split(/\s+/)[0] ?? '';
    if (language && language !== 'json') continue;

    const body = match[2].trim();
    if (!body) continue;

    try {
      const plan = normalizePlan(JSON.parse(body));
      if (plan) {
        return {
          end: match.index + match[0].length,
          plan,
          start: match.index,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function normalizePlan(value: unknown): OrchestratorPlan | null {
  if (!isRecord(value) || value.type !== 'parallel_worker_plan' || !Array.isArray(value.tasks)) {
    return null;
  }

  const tasks = value.tasks.map(normalizeTask);
  if (
    tasks.length < MIN_ORCHESTRATOR_TASKS ||
    tasks.length > MAX_ORCHESTRATOR_TASKS ||
    tasks.some(task => task === null) ||
    new Set(tasks.map(task => task?.id)).size !== tasks.length
  ) {
    return null;
  }

  return {
    type: 'parallel_worker_plan',
    tasks: tasks as OrchestratorTask[],
  };
}

function normalizeTask(value: unknown): OrchestratorTask | null {
  if (!isRecord(value)) return null;

  const dependencyKeys = [
    'after',
    'dependencies',
    'dependsOn',
    'depends_on',
    'parentTaskId',
    'requires',
    'requiredTaskIds',
  ];
  if (dependencyKeys.some(key => Object.hasOwn(value, key))) {
    return null;
  }

  const id = nonEmptyString(value.id);
  const description = nonEmptyString(value.description);
  const prompt = nonEmptyString(value.prompt);

  if (!id || !description || !prompt) return null;
  return { id, description, prompt };
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

