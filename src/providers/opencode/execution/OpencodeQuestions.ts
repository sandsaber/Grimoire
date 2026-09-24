import type { FormInfo1, FormOption, FormValue } from '@opencode/client';

import type { AskUserAnswers } from '@/core/types';
import type { AcpQuestion } from '@/providers/acp/execution/AcpQuestionPresenter';
import type { AcpRequestPermissionResponse } from '@/providers/acp/types';

export type OpencodeQuestionResponse = AcpRequestPermissionResponse & { answers?: AskUserAnswers };

function optionLabel(option: FormOption, options: readonly FormOption[]): string {
  return options.filter(candidate => candidate.label === option.label).length > 1
    ? `${option.label} (${option.value})` : option.label;
}

/** Field keys stay out of UI answer objects; only the provider reply uses native keys. */
export function opencodeFormQuestions(form: FormInfo1): AcpQuestion[] | null {
  if (form.fields.some(field => field.type === 'external' || field.when?.length)) return null;
  const questions = form.fields.flatMap((field, index) => {
    if ((field as { hidden?: boolean }).hidden) return [];
    const options = 'options' in field ? field.options ?? [] : [];
    return [{
      id: `opencode-field-${index}`,
      header: field.title ?? form.title,
      question: field.description ?? field.title ?? form.title,
      multiSelect: field.type === 'multiselect',
      isOther: field.type !== 'boolean' && (!options.length || ('custom' in field && field.custom === true)),
      options: field.type === 'boolean'
        ? [{ label: 'Yes' }, { label: 'No' }]
        : options.map(option => ({ label: optionLabel(option, options), description: option.description })),
    }];
  });
  return questions.length ? questions : null;
}

export function opencodeFormAnswers(form: FormInfo1, answers: AskUserAnswers): Record<string, FormValue> | null {
  const entries: Array<[string, FormValue]> = [];
  for (const [index, field] of form.fields.entries()) {
    if (field.type === 'external') return null;
    if ((field as { hidden?: boolean }).hidden) continue;
    const answer = answers[`opencode-field-${index}`];
    if (answer === undefined) {
      if (field.required) return null;
      continue;
    }
    const values = Array.isArray(answer) ? answer : [answer];
    const options = 'options' in field ? field.options ?? [] : [];
    const mapped = values.map(value => options.find(option => optionLabel(option, options) === value)?.value ?? value);
    if (options.length && !('custom' in field && field.custom)
      && mapped.some(value => !options.some(option => option.value === value))) return null;
    if (field.type === 'multiselect') {
      entries.push([field.key, mapped]);
      continue;
    }
    if (mapped.length !== 1) return null;
    const value = mapped[0];
    if (field.type === 'boolean') {
      if (!['Yes', 'No'].includes(value)) return null;
      entries.push([field.key, value === 'Yes']);
    } else if (field.type === 'number' || field.type === 'integer') {
      const number = Number(value);
      if (!value.trim() || !Number.isFinite(number) || (field.type === 'integer' && !Number.isInteger(number))) return null;
      entries.push([field.key, number]);
    } else {
      entries.push([field.key, value]);
    }
  }
  return Object.fromEntries(entries);
}
