import { setIcon } from 'obsidian';

import { markDecorative } from '@/shared/components/activatable';

import type { AskUserQuestionItem, AskUserQuestionOption } from '../../../core/types/tools';
import { t } from '../../../i18n/i18n';

export interface InlineAskQuestionConfig {
  title?: string;
  headerEl?: HTMLElement;
  showCustomInput?: boolean;
  immediateSelect?: boolean;
}

interface QuestionState {
  selectedValues: Set<string>;
  freeformText: string;
}

export class InlineAskUserQuestion {
  private containerEl: HTMLElement;
  private input: Record<string, unknown>;
  private resolveCallback: (result: Record<string, string | string[]> | null) => void;
  private resolved = false;
  private signal?: AbortSignal;
  private config: Required<Omit<InlineAskQuestionConfig, 'headerEl'>> & { headerEl?: HTMLElement };

  private questions: AskUserQuestionItem[] = [];
  private questionStates: QuestionState[] = [];

  private rootEl!: HTMLElement;
  private formEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private submitBtn!: HTMLButtonElement;
  private collapseBtn!: HTMLButtonElement;
  private collapseIconEl!: HTMLElement;

  private focusedBlockIdx = 0;
  private focusedOptIdx = 0;
  private isFreeformFocused = false;
  private isCollapsed = false;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private abortHandler: (() => void) | null = null;

  private blockEls: HTMLElement[] = [];
  private optRows: HTMLElement[][] = [];
  private freeformEls: (HTMLTextAreaElement | null)[] = [];

  constructor(
    containerEl: HTMLElement,
    input: Record<string, unknown>,
    resolve: (result: Record<string, string | string[]> | null) => void,
    signal?: AbortSignal,
    config?: InlineAskQuestionConfig,
  ) {
    this.containerEl = containerEl;
    this.input = input;
    this.resolveCallback = resolve;
    this.signal = signal;
    this.config = {
      title: config?.title ?? t('chat.ui.ask.question'),
      headerEl: config?.headerEl,
      showCustomInput: config?.showCustomInput ?? true,
      immediateSelect: config?.immediateSelect ?? false,
    };
    this.boundKeyDown = (event) => this.handleKeyDown(event);
  }

  render(): void {
    this.rootEl = this.containerEl.createDiv({ cls: 'grimoire-ask-anchor' });
    this.formEl = this.rootEl.createDiv({ cls: 'grimoire-ask-form' });

    this.questions = this.parseQuestions();
    if (this.questions.length === 0) {
      this.handleResolve(null);
      return;
    }

    if (this.config.immediateSelect && this.questions.length !== 1) {
      this.config.immediateSelect = false;
    }

    for (let i = 0; i < this.questions.length; i++) {
      this.questionStates.push({ selectedValues: new Set(), freeformText: '' });
    }

    this.renderHeader();
    this.renderBody();
    this.renderActions();

    this.rootEl.setAttribute('tabindex', '0');
    this.rootEl.addEventListener('keydown', this.boundKeyDown);

    window.requestAnimationFrame(() => {
      this.rootEl.focus();
      this.rootEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    if (this.signal) {
      this.abortHandler = () => this.handleResolve(null);
      this.signal.addEventListener('abort', this.abortHandler, { once: true });
    }
  }

  destroy(): void {
    this.handleResolve(null);
  }

  private renderHeader(): void {
    const head = this.formEl.createDiv({ cls: 'grimoire-ask-head' });

    const glyph = head.createDiv({ cls: 'grimoire-ask-glyph' });
    setIcon(glyph, 'message-circle-question');

    const titleBlock = head.createDiv({ cls: 'grimoire-ask-title-block' });
    titleBlock.createDiv({ text: t('chat.ui.ask.needsDetail'), cls: 'grimoire-ask-title' });
    const questionCount = this.questions.length;
    titleBlock.createDiv({
      text: t(questionCount === 1
        ? 'chat.ui.ask.questionCountOne'
        : 'chat.ui.ask.questionCountMany', { count: questionCount }),
      cls: 'grimoire-ask-subtitle',
    });

    const pill = head.createDiv({ cls: 'grimoire-ask-tool-pill' });
    setIcon(pill.createSpan(), 'message-circle');
    pill.createSpan({ text: 'ask_user' });

    this.collapseBtn = head.createEl('button', {
      cls: 'grimoire-ask-collapse-toggle',
      attr: { type: 'button' },
    });
    this.collapseIconEl = this.collapseBtn.createSpan({ cls: 'grimoire-ask-collapse-icon' });
    this.collapseBtn.addEventListener('click', () => {
      this.setCollapsed(!this.isCollapsed);
    });
    this.collapseBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.stopPropagation();
      }
    });
    this.refreshCollapseToggle();
  }

  private renderBody(): void {
    this.bodyEl = this.formEl.createDiv({ cls: 'grimoire-ask-body' });
    this.blockEls = [];
    this.optRows = [];
    this.freeformEls = [];

    for (let blockIdx = 0; blockIdx < this.questions.length; blockIdx++) {
      const q = this.questions[blockIdx];
      const block = this.bodyEl.createDiv({ cls: 'grimoire-ask-qblock' });
      this.blockEls.push(block);

      const topRow = block.createDiv({ cls: 'grimoire-ask-q-top' });
      topRow.createSpan({
        text: String(blockIdx + 1).padStart(2, '0'),
        cls: 'grimoire-ask-q-num',
      });
      topRow.createSpan({ text: q.question, cls: 'grimoire-ask-q-title' });

      const kind = this.getQuestionKind(q, blockIdx);
      topRow.createSpan({ text: this.getQuestionKindLabel(kind), cls: 'grimoire-ask-q-kind' });

      if (q.options.length > 0) {
        const optsEl = block.createDiv({ cls: 'grimoire-ask-opts' });
        const rows: HTMLElement[] = [];

        for (let optIdx = 0; optIdx < q.options.length; optIdx++) {
          const option = q.options[optIdx];
          const row = optsEl.createDiv({ cls: 'grimoire-ask-opt' });

          const mark = row.createDiv({ cls: 'grimoire-ask-opt-mark' });
          if (q.multiSelect) {
            const box = mark.createDiv({ cls: 'grimoire-ask-opt-box' });
            setIcon(box, 'check');
            row.setAttribute('role', 'checkbox');
            row.setAttribute('aria-checked', 'false');
          } else {
            mark.createDiv({ cls: 'grimoire-ask-opt-ring' });
            row.setAttribute('role', 'radio');
            row.setAttribute('aria-checked', 'false');
          }

          row.createSpan({ text: option.label, cls: 'grimoire-ask-opt-text' });

          const capturedBlockIdx = blockIdx;
          const capturedOptIdx = optIdx;
          row.addEventListener('click', () => {
            this.focusedBlockIdx = capturedBlockIdx;
            this.focusedOptIdx = capturedOptIdx;
            this.selectOption(capturedBlockIdx, capturedOptIdx);
          });

          rows.push(row);
        }
        this.optRows.push(rows);
      } else {
        this.optRows.push([]);
      }

      if (this.isFreeformQuestion(q, blockIdx)) {
        const ta = block.createEl('textarea', { cls: 'grimoire-ask-freeform' });
        ta.setAttribute('rows', '1');
        ta.setAttribute('placeholder', t('chat.ui.ask.answerPlaceholder'));
        ta.addEventListener('input', () => {
          this.questionStates[blockIdx].freeformText = ta.value;
          ta.setCssProps({ height: Math.min(80, ta.scrollHeight) + 'px' });
          this.refreshValidity();
        });
        ta.addEventListener('focus', () => {
          this.focusedBlockIdx = blockIdx;
          this.isFreeformFocused = true;
        });
        ta.addEventListener('blur', () => {
          this.isFreeformFocused = false;
        });
        this.freeformEls.push(ta);
      } else {
        this.freeformEls.push(null);
      }
    }
  }

  private renderActions(): void {
    const actions = this.formEl.createDiv({ cls: 'grimoire-ask-actions' });

    actions.createDiv({ cls: 'grimoire-ask-grow' });

    const skipBtn = actions.createEl('button', {
      cls: 'grimoire-ask-btn grimoire-ask-btn--skip',
      text: t('chat.ui.ask.decideForMe'),
    });
    skipBtn.addEventListener('click', () => this.handleSkip());

    this.submitBtn = actions.createEl('button', {
      cls: 'grimoire-ask-btn grimoire-ask-btn--submit',
    });
    // The arrow follows the words: it says where this sends you, and a glyph
    // in front of a verb reads as an icon button that happens to have a label.
    this.submitBtn.createSpan({ text: t('chat.ui.ask.sendAnswers') });
    const submitArrow = this.submitBtn.createSpan({ cls: 'grimoire-ask-btn-arrow' });
    setIcon(submitArrow, 'arrow-right');
    markDecorative(submitArrow);
    this.submitBtn.addEventListener('click', () => this.handleSubmit());

    this.refreshValidity();
  }

  private getQuestionKind(q: AskUserQuestionItem, _idx: number): string {
    if (q.options.length === 0) return 'freeform';
    return q.multiSelect ? 'multi' : 'single';
  }

  private getQuestionKindLabel(kind: string): string {
    if (kind === 'single') return t('chat.ui.ask.single');
    if (kind === 'multi') return t('chat.ui.ask.multiple');
    if (kind === 'freeform') return t('chat.ui.ask.optional');
    return kind;
  }

  private isFreeformQuestion(q: AskUserQuestionItem, _idx: number): boolean {
    return q.options.length === 0 || q.isOther === true || this.config.showCustomInput;
  }

  private isRequired(blockIdx: number): boolean {
    const q = this.questions[blockIdx];
    if (q.options.length === 0) return false;
    return true;
  }

  private isBlockAnswered(blockIdx: number): boolean {
    const state = this.questionStates[blockIdx];
    return state.selectedValues.size > 0 || state.freeformText.trim().length > 0;
  }

  private isValid(): boolean {
    for (let i = 0; i < this.questions.length; i++) {
      if (this.isRequired(i) && !this.isBlockAnswered(i)) return false;
    }
    return true;
  }

  private refreshValidity(): void {
    if (this.submitBtn) {
      this.submitBtn.disabled = !this.isValid();
    }
  }

  private setCollapsed(isCollapsed: boolean): void {
    if (this.isCollapsed === isCollapsed) return;

    this.isCollapsed = isCollapsed;
    this.rootEl.classList.toggle('is-collapsed', isCollapsed);

    if (isCollapsed && this.isFreeformFocused) {
      this.isFreeformFocused = false;
      (this.rootEl.ownerDocument.activeElement as HTMLElement | null)?.blur();
      this.rootEl.focus();
    }

    this.updateFocusVisuals();
    this.refreshCollapseToggle();
  }

  private refreshCollapseToggle(): void {
    if (!this.collapseBtn) return;

    const label = this.isCollapsed ? t('chat.ui.ask.expand') : t('chat.ui.ask.collapse');
    this.collapseBtn.setAttribute('aria-label', label);
    this.collapseBtn.setAttribute('title', label);
    this.collapseBtn.setAttribute('aria-expanded', String(!this.isCollapsed));

    if (this.collapseIconEl) {
      this.collapseIconEl.empty();
      setIcon(this.collapseIconEl, this.isCollapsed ? 'chevron-up' : 'chevron-down');
    }
  }

  private selectOption(blockIdx: number, optIdx: number): void {
    const q = this.questions[blockIdx];
    const option = q.options[optIdx];
    const state = this.questionStates[blockIdx];
    const optionValue = this.getOptionValue(option);

    if (this.config.immediateSelect) {
      const key = q.id ?? q.question;
      const result: Record<string, string> = {};
      result[key] = optionValue;
      this.handleResolve(result);
      return;
    }

    if (q.multiSelect) {
      if (state.selectedValues.has(optionValue)) {
        state.selectedValues.delete(optionValue);
      } else {
        state.selectedValues.add(optionValue);
      }
    } else {
      state.selectedValues.clear();
      state.selectedValues.add(optionValue);
      state.freeformText = '';
      const ta = this.freeformEls[blockIdx];
      if (ta) ta.value = '';
    }

    this.updateOptionVisuals(blockIdx);
    this.refreshValidity();
  }

  private updateOptionVisuals(blockIdx: number): void {
    const q = this.questions[blockIdx];
    const state = this.questionStates[blockIdx];
    const rows = this.optRows[blockIdx];

    for (let i = 0; i < rows.length; i++) {
      const optionValue = this.getOptionValue(q.options[i]);
      const isSelected = state.selectedValues.has(optionValue);

      rows[i].toggleClass('is-selected', isSelected);
      rows[i].setAttribute('aria-checked', String(isSelected));
    }
  }

  private updateFocusVisuals(): void {
    for (let b = 0; b < this.optRows.length; b++) {
      for (let o = 0; o < this.optRows[b].length; o++) {
        this.optRows[b][o].toggleClass(
          'is-focused',
          b === this.focusedBlockIdx && o === this.focusedOptIdx && !this.isFreeformFocused && !this.isCollapsed,
        );
      }
    }
  }

  private handleSubmit(): void {
    if (!this.isValid()) return;

    const result: Record<string, string | string[]> = {};
    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      const key = q.id ?? q.question;
      const state = this.questionStates[i];
      const selectedValues = [...state.selectedValues];
      const freeform = state.freeformText.trim();

      if (q.multiSelect) {
        const answers = [...selectedValues];
        if (freeform) answers.push(freeform);
        result[key] = answers;
        continue;
      }

      result[key] = freeform || selectedValues[0] || '';
    }

    this.handleResolve(result);
  }

  private handleSkip(): void {
    this.handleResolve({});
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.isFreeformFocused) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.isFreeformFocused = false;
        (this.rootEl.ownerDocument.activeElement as HTMLElement | null)?.blur();
        this.rootEl.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.isFreeformFocused = false;
        if (this.isValid()) this.handleSubmit();
        return;
      }
      return;
    }

    if (this.isCollapsed) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.handleResolve(null);
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (this.isValid()) this.handleSubmit();
      return;
    }

    const maxBlockIdx = this.questions.length - 1;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        e.stopPropagation();
        if (this.focusedOptIdx < this.optRows[this.focusedBlockIdx].length - 1) {
          this.focusedOptIdx++;
        } else if (this.focusedBlockIdx < maxBlockIdx) {
          this.focusedBlockIdx++;
          this.focusedOptIdx = 0;
        }
        this.updateFocusVisuals();
        this.scrollFocusedIntoView();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        e.stopPropagation();
        if (this.focusedOptIdx > 0) {
          this.focusedOptIdx--;
        } else if (this.focusedBlockIdx > 0) {
          this.focusedBlockIdx--;
          this.focusedOptIdx = Math.max(0, this.optRows[this.focusedBlockIdx].length - 1);
        }
        this.updateFocusVisuals();
        this.scrollFocusedIntoView();
        break;
      }
      case 'Enter': {
        e.preventDefault();
        e.stopPropagation();
        const rows = this.optRows[this.focusedBlockIdx];
        if (this.focusedOptIdx < rows.length) {
          this.selectOption(this.focusedBlockIdx, this.focusedOptIdx);
        } else {
          const ta = this.freeformEls[this.focusedBlockIdx];
          if (ta) {
            this.isFreeformFocused = true;
            ta.focus();
          }
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        this.handleResolve(null);
        break;
      }
    }
  }

  private scrollFocusedIntoView(): void {
    const rows = this.optRows[this.focusedBlockIdx];
    if (rows[this.focusedOptIdx]) {
      rows[this.focusedOptIdx].scrollIntoView({ block: 'nearest' });
    }
  }

  private parseQuestions(): AskUserQuestionItem[] {
    const raw = this.input.questions;
    if (!Array.isArray(raw)) return [];

    return (raw as unknown[])
      .filter(
        (q): q is {
          question: string;
          header?: string;
          options?: unknown[] | null;
          multiSelect?: boolean;
          isOther?: boolean;
          isSecret?: boolean;
          id?: string;
        } => {
          if (!q || typeof q !== 'object' || Array.isArray(q)) {
            return false;
          }
          const record = q as Record<string, unknown>;
          return typeof record.question === 'string'
            && ((Array.isArray(record.options) && record.options.length > 0)
              || record.isOther === true
              || this.config.showCustomInput);
        },
      )
      .map((q, idx) => ({
        question: q.question,
        id: typeof (q as Record<string, unknown>).id === 'string' ? (q as Record<string, unknown>).id as string : undefined,
        header: typeof q.header === 'string' ? q.header.slice(0, 12) : `Q${idx + 1}`,
        options: this.deduplicateOptions((q.options ?? []).map((o) => this.coerceOption(o))),
        multiSelect: q.multiSelect === true,
        isOther: q.isOther === true,
        isSecret: q.isSecret === true,
      }));
  }

  private coerceOption(opt: unknown): AskUserQuestionOption {
    if (typeof opt === 'object' && opt !== null) {
      const obj = opt as Record<string, unknown>;
      const label = this.extractLabel(obj);
      const description = typeof obj.description === 'string' ? obj.description : '';
      const value = this.extractValue(obj, label);
      return { label, description, ...(value !== label ? { value } : {}) };
    }
    return { label: this.stringifyOptionValue(opt), description: '' };
  }

  private deduplicateOptions(options: AskUserQuestionOption[]): AskUserQuestionOption[] {
    const seen = new Set<string>();
    return options.filter((o) => {
      if (seen.has(o.label)) return false;
      seen.add(o.label);
      return true;
    });
  }

  private extractLabel(obj: Record<string, unknown>): string {
    if (typeof obj.label === 'string') return obj.label;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.name === 'string') return obj.name;
    return t('chat.ui.ask.option');
  }

  private stringifyOptionValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return `${value}`;
    }
    return t('chat.ui.ask.option');
  }

  private extractValue(obj: Record<string, unknown>, fallback: string): string {
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.id === 'string') return obj.id;
    return fallback;
  }

  private getOptionValue(option: AskUserQuestionOption): string {
    return option.value ?? option.label;
  }

  private handleResolve(result: Record<string, string | string[]> | null): void {
    if (!this.resolved) {
      this.resolved = true;
      this.rootEl?.removeEventListener('keydown', this.boundKeyDown);
      if (this.signal && this.abortHandler) {
        this.signal.removeEventListener('abort', this.abortHandler);
        this.abortHandler = null;
      }
      this.rootEl?.remove();
      this.resolveCallback(result);
    }
  }
}
