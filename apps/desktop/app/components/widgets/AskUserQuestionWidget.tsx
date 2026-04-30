import { useMemo, useState } from 'react';
import { HelpCircle, Check, ArrowRight, Edit3 } from 'lucide-react';
import type { WidgetProps } from './registry';

interface Option {
  label: string;
  value: string;
  description?: string;
}

interface Question {
  question: string;
  options: Option[];
}

type Selection = { kind: 'preset'; value: string } | { kind: 'custom'; value: string };

const CUSTOM_OPTION_LABEL = '其他（自己说）';

function packAnswer(questions: Question[], selections: Map<number, Selection>): string {
  if (questions.length === 1) {
    return selections.get(0)?.value.trim() ?? '';
  }
  return questions
    .map((q, i) => `[问题 ${i + 1}] ${q.question}\n回答：${selections.get(i)?.value.trim() ?? ''}`)
    .join('\n\n');
}

// Try to parse a previously-submitted answer back into per-question values.
// Returns Map<questionIndex, answerText> on success, or null if parse failed / shape doesn't match.
function parseAnswer(questions: Question[], answer: string): Map<number, string> | null {
  if (questions.length === 1) {
    return new Map([[0, answer.trim()]]);
  }
  const parsed = new Map<number, string>();
  const re = /\[问题\s*(\d+)\][^\n]*\n回答：([\s\S]*?)(?=\n\n\[问题\s*\d+\]|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const idx = parseInt(m[1], 10) - 1;
    const text = m[2].trim();
    if (idx >= 0 && idx < questions.length && text) parsed.set(idx, text);
  }
  if (parsed.size !== questions.length) return null;
  return parsed;
}

export function AskUserQuestionWidget({ part, onSubmit, answer }: WidgetProps) {
  const questions: Question[] = part?.input?.questions ?? [];
  const isAnswered = !!answer;

  const [selections, setSelections] = useState<Map<number, Selection>>(new Map());
  const [customDrafts, setCustomDrafts] = useState<Map<number, string>>(new Map());

  const parsedAnswers = useMemo(
    () => (isAnswered ? parseAnswer(questions, answer!) : null),
    [isAnswered, answer, questions],
  );

  if (!questions.length) return null;

  const headerTitle = questions.length === 1 ? questions[0].question : `帮我确认 ${questions.length} 件事`;
  const allAnswered = questions.every((_, i) => {
    const sel = selections.get(i);
    return sel && sel.value.trim().length > 0;
  });

  const handlePickPreset = (qIdx: number, value: string) => {
    if (isAnswered) return;
    const next = new Map(selections);
    next.set(qIdx, { kind: 'preset', value });
    setSelections(next);
  };

  const handlePickCustom = (qIdx: number) => {
    if (isAnswered) return;
    const draft = customDrafts.get(qIdx) ?? '';
    const next = new Map(selections);
    next.set(qIdx, { kind: 'custom', value: draft });
    setSelections(next);
  };

  const handleCustomDraftChange = (qIdx: number, text: string) => {
    if (isAnswered) return;
    const drafts = new Map(customDrafts);
    drafts.set(qIdx, text);
    setCustomDrafts(drafts);
    const next = new Map(selections);
    next.set(qIdx, { kind: 'custom', value: text });
    setSelections(next);
  };

  const handleSubmit = () => {
    if (!onSubmit || isAnswered || !allAnswered) return;
    const text = packAnswer(questions, selections);
    if (text.length === 0) return;
    onSubmit(text);
  };

  return (
    <div className="mt-4 mb-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800/70">
        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
          {headerTitle}
        </div>
        {isAnswered && (
          <div className="text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
            <Check className="w-3 h-3" />
            已回答
          </div>
        )}
      </div>

      <div className="p-3 space-y-3">
        {questions.map((q, qIdx) => {
          const isMulti = questions.length > 1;
          const sel = selections.get(qIdx);
          const parsedThis = parsedAnswers?.get(qIdx);
          // In answered mode, find which option matches the parsed answer (if any).
          const matchedOptionValue = isAnswered && parsedThis
            ? q.options.find((o) => o.value === parsedThis)?.value ?? null
            : null;
          const showUnmatchedAnswer = isAnswered && parsedThis && !matchedOptionValue;
          const showFallbackAnswer = isAnswered && !parsedThis;

          const options = q.options ?? [];
          return (
            <div key={qIdx} className={isMulti ? 'pt-1' : ''}>
              {isMulti && (
                <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2 px-1">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-[10px] font-bold mr-1.5">
                    {qIdx + 1}
                  </span>
                  {q.question}
                </div>
              )}
              <div className="space-y-1.5">
                {options.map((opt) => {
                  const isPicked = !isAnswered && sel?.kind === 'preset' && sel.value === opt.value;
                  const isAnsweredMatch = isAnswered && matchedOptionValue === opt.value;
                  const dim = isAnswered && !isAnsweredMatch;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isAnswered}
                      onClick={() => handlePickPreset(qIdx, opt.value)}
                      className={`w-full text-left rounded-xl border px-3 py-2 transition-all ${
                        isAnswered ? 'cursor-default' : 'cursor-pointer'
                      } ${
                        isPicked || isAnsweredMatch
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 shadow-sm'
                          : dim
                            ? 'border-zinc-200/60 dark:border-zinc-800/60 opacity-50'
                            : 'border-zinc-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                            {opt.label}
                          </div>
                          {opt.description && (
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                              {opt.description}
                            </div>
                          )}
                        </div>
                        {(isPicked || isAnsweredMatch) && (
                          <Check className="w-4 h-4 text-indigo-500 dark:text-indigo-400 flex-shrink-0 mt-0.5" strokeWidth={3} />
                        )}
                      </div>
                    </button>
                  );
                })}

                {/* Auto-injected "其他" open-ended option */}
                {(() => {
                  const isCustomActive = !isAnswered && sel?.kind === 'custom';
                  const customDraft = customDrafts.get(qIdx) ?? '';
                  const dimCustom = isAnswered;
                  if (isAnswered) {
                    // In answered mode, hide the "其他" button; we render the
                    // unmatched/fallback answer note below the option list instead.
                    return null;
                  }
                  if (!isCustomActive) {
                    return (
                      <button
                        type="button"
                        onClick={() => handlePickCustom(qIdx)}
                        className={`w-full text-left rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-3 py-2 transition-all cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500/60 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/5 ${
                          dimCustom ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>{CUSTOM_OPTION_LABEL}</span>
                        </div>
                      </button>
                    );
                  }
                  return (
                    <div className="rounded-xl border-2 border-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/5 px-3 py-2">
                      <div className="flex items-center gap-2 text-[11px] text-indigo-600 dark:text-indigo-400 mb-1.5 font-medium">
                        <Edit3 className="w-3 h-3" />
                        自定义回复
                      </div>
                      <input
                        type="text"
                        autoFocus
                        value={customDraft}
                        onChange={(e) => handleCustomDraftChange(qIdx, e.target.value)}
                        placeholder="自己说一句…"
                        className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none"
                      />
                    </div>
                  );
                })()}

                {showUnmatchedAnswer && (
                  <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/60 dark:bg-indigo-500/10 px-3 py-2 text-sm text-indigo-700 dark:text-indigo-300">
                    <span className="text-[11px] font-medium text-indigo-500 dark:text-indigo-400 mr-1.5">你的回答：</span>
                    {parsedThis}
                  </div>
                )}
              </div>
              {showFallbackAnswer && qIdx === questions.length - 1 && (
                <div className="mt-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                  <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mr-1.5">你的回答：</span>
                  {answer}
                </div>
              )}
            </div>
          );
        })}

        {!isAnswered && onSubmit && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={!allAnswered}
              onClick={handleSubmit}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500 text-white cursor-pointer"
            >
              提交
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
