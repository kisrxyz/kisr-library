import { useEffect, useId, useState } from 'preact/hooks';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Segmented';
import { toast } from '../../ui/Toast';
import { DEFAULT_SIZE, FORMAT_BLOCK, SIZES, buildPrompt, claudeUrl, type Size } from './prompt';
import './PromptBuilder.css';

const SKILL_KEY = 'kisr-library:skill-installed';

/** По умолчанию скилл считается установленным: так запрос короче. Хранилище может быть недоступно — тогда просто «вкл». */
function readSkillFlag(): boolean {
  try {
    return localStorage.getItem(SKILL_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeSkillFlag(on: boolean): void {
  try {
    localStorage.setItem(SKILL_KEY, on ? '1' : '0');
  } catch {
    // приватный режим или запрещённое хранилище: выбор живёт до закрытия вкладки
  }
}

const SIZE_OPTIONS = SIZES.map((s) => ({ value: s.value, label: s.label }));

/** «Попросить Claude»: тема, объём, пожелания → запрос, который копируют или открывают в Claude. */
export function PromptBuilder() {
  const [topic, setTopic] = useState('');
  const [size, setSize] = useState<Size>(DEFAULT_SIZE);
  const [wishes, setWishes] = useState('');
  const [skill, setSkill] = useState(readSkillFlag);
  const [showText, setShowText] = useState(false);
  const heading = useId();

  useEffect(() => writeSkillFlag(skill), [skill]);

  const ready = topic.trim() !== '';
  const prompt = buildPrompt({ topic, size, wishes, skillInstalled: skill, formatBlock: FORMAT_BLOCK });
  const url = ready ? claudeUrl(prompt) : null;
  const picked = SIZES.find((s) => s.value === size) ?? SIZES[1];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast('Запрос скопирован');
    } catch {
      // Буфер недоступен: показываем текст, чтобы его можно было выделить и скопировать руками
      setShowText(true);
      toast('Не удалось скопировать: выдели текст запроса и скопируй сам');
    }
  };

  return (
    <section class="pb" aria-labelledby={heading}>
      <h2 id={heading} class="add__label">
        Попросить Claude
      </h2>
      <div class="pb__card">
        <label class="pf">
          <span class="pf__label">Тема</span>
          <input
            class="pf__input"
            type="text"
            value={topic}
            placeholder="Например: как работает память"
            autocomplete="off"
            enterkeyhint="done"
            onInput={(e) => setTopic(e.currentTarget.value)}
          />
        </label>

        <div class="pb__size">
          <span class="pf__label">Объём</span>
          <Segmented label="Объём книги" options={SIZE_OPTIONS} value={size} onChange={setSize} />
          <p class="pb__hint">
            ≈ {picked.minutes}&nbsp;мин чтения · {picked.words} слов
          </p>
        </div>

        <label class="pf">
          <span class="pf__label">Пожелания, если есть</span>
          <textarea
            class="pf__input pf__input--area"
            rows={2}
            value={wishes}
            placeholder="Для кого, что разобрать подробнее, чего избегать"
            onInput={(e) => setWishes(e.currentTarget.value)}
          />
        </label>

        <label class="switch">
          <input
            class="switch__input"
            type="checkbox"
            role="switch"
            checked={skill}
            onChange={(e) => setSkill(e.currentTarget.checked)}
          />
          <span class="switch__track" aria-hidden="true" />
          <span class="switch__text">
            <span class="switch__title">Скилл установлен в Claude</span>
            <span class="switch__sub">
              {skill ? 'Запрос короткий: формат Claude знает сам.' : 'В запрос добавится описание формата, он станет длинным.'}
            </span>
          </span>
        </label>

        <div class="pb__actions">
          <Button variant="primary" icon="copy" wide disabled={!ready} onClick={() => void copy()}>
            Скопировать запрос
          </Button>
          {/* Без темы кнопка стоит на месте, но не нажимается; если запрос не влезает в ссылку — её нет совсем */}
          {(url || !ready) && (
            <Button icon="send" wide disabled={!url} onClick={() => url && window.open(url, '_blank', 'noopener')}>
              Открыть Claude
            </Button>
          )}
        </div>
        {ready && !url && (
          <p class="pb__hint">Запрос длинный и в ссылку не поместится: скопируй его и вставь в Claude сам.</p>
        )}

        <details
          class="pb__text"
          open={showText}
          onToggle={(e) => setShowText((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>Показать запрос</summary>
          <textarea
            class="pf__input pf__input--area pb__preview"
            rows={7}
            readOnly
            value={prompt}
            aria-label="Текст запроса"
            onFocus={(e) => e.currentTarget.select()}
          />
        </details>
      </div>
    </section>
  );
}
