import { createMockEl, type MockElement } from '@test/helpers/mockElement';

import { InlineOrchestratorPlan } from '@/features/chat/rendering/InlineOrchestratorPlan';
import type { OrchestratorPlan } from '@/features/chat/rendering/orchestratorPlanParser';
import { setLocale } from '@/i18n/i18n';

const plan: OrchestratorPlan = {
  type: 'parallel_worker_plan' as const,
  tasks: [
    {
      id: 'parser',
      description: 'Add provider-neutral parser',
      prompt: 'Implement parser tests and code',
    },
    {
      id: 'renderer',
      description: 'Render inline approval controls',
      prompt: 'Implement renderer tests and code',
    },
  ],
};

function collectText(el: MockElement): string {
  return [
    el.textContent,
    ...el.children.map(child => collectText(child)),
  ].filter(Boolean).join(' ');
}

function collectClasses(el: MockElement): string[] {
  return [
    ...el.getClasses(),
    ...el.children.flatMap(child => collectClasses(child)),
  ];
}

function renderPlan(
  presentation: ConstructorParameters<typeof InlineOrchestratorPlan>[3] = {},
) {
  const container = createMockEl();
  const resolve = jest.fn<void, [unknown]>();
  const widget = new InlineOrchestratorPlan(container as HTMLElement, plan, resolve, presentation);

  widget.render();

  const root = container.querySelector('.grimoire-orchestrator-plan-inline');
  expect(root).toBeTruthy();

  return { container, resolve, root: root!, widget };
}

describe('InlineOrchestratorPlan', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('renders task descriptions and approval buttons with Grimoire classes', () => {
    const { container, root } = renderPlan();
    const text = collectText(root);

    expect(text).toContain('Add provider-neutral parser');
    expect(text).toContain('Render inline approval controls');
    expect(text).toContain('Independent tasks for this note');
    expect(text).toContain('2 of 2 selected');
    expect(text).toContain('Start background work');
    expect(text).toContain('Cancel');
    expect(root.querySelectorAll('.grimoire-orchestrator-plan-task')).toHaveLength(2);

    const classes = collectClasses(container);
    expect(classes.some(cls => cls.startsWith('grimoire-'))).toBe(true);
  });

  it('renders orchestrator controls in the active locale', () => {
    setLocale('ru');

    const { root } = renderPlan();
    const text = collectText(root);

    expect(text).toContain('Независимые задачи для этой заметки');
    expect(text).toContain('Выбрано 2 из 2');
    expect(text).toContain('Запустить фоновую работу');
    expect(text).toContain('Отмена');
  });

  it('shows the inherited model on every worker row', () => {
    const { root } = renderPlan({ modelLabel: 'GPT-5.6-Luna', providerId: 'codex' });

    expect(root.querySelectorAll('.grimoire-orchestrator-plan-model')).toHaveLength(2);
    expect(collectText(root)).toContain('GPT-5.6-Luna');
  });

  it('spawns only selected tasks and keeps the count in sync', () => {
    const { resolve, root } = renderPlan();
    const toggles = root.querySelectorAll('.grimoire-orchestrator-plan-task-toggle');

    toggles[0].click();
    expect(collectText(root)).toContain('1 of 2 selected');

    root.querySelector('.grimoire-orchestrator-plan-spawn-button')!.click();
    expect(resolve).toHaveBeenCalledWith({
      type: 'spawn_workers',
      plan: {
        ...plan,
        tasks: [plan.tasks[1]],
      },
    });
  });

  it('disables spawning when every task is deselected', () => {
    const { root } = renderPlan();
    const toggles = root.querySelectorAll('.grimoire-orchestrator-plan-task-toggle');

    toggles.forEach((toggle: MockElement) => toggle.click());

    expect(root.querySelector('.grimoire-orchestrator-plan-spawn-button')!.disabled).toBe(true);
  });

  it('resolves with spawn_workers and disables both buttons after spawning', () => {
    const { resolve, root } = renderPlan();

    const spawnButton = root.querySelector('.grimoire-orchestrator-plan-spawn-button')!;
    const cancelButton = root.querySelector('.grimoire-orchestrator-plan-cancel-button')!;

    spawnButton.click();
    cancelButton.click();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ type: 'spawn_workers', plan });
    expect(spawnButton.disabled).toBe(true);
    expect(cancelButton.disabled).toBe(true);
  });

  it('resolves with cancel and disables both buttons after cancelling', () => {
    const { resolve, root } = renderPlan();

    const spawnButton = root.querySelector('.grimoire-orchestrator-plan-spawn-button')!;
    const cancelButton = root.querySelector('.grimoire-orchestrator-plan-cancel-button')!;

    cancelButton.click();
    spawnButton.click();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ type: 'cancel' });
    expect(spawnButton.disabled).toBe(true);
    expect(cancelButton.disabled).toBe(true);
  });
});
