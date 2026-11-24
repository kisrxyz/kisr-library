import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_REPO, connectSync, disconnectSync, syncNow, syncView } from '../../state/sync';
import type { SyncResult } from '../../sync/engine';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/Toast';
import { syncStatusLine } from './format';
import { Section } from './Section';

/** Новый приватный репозиторий с нужным названием (spec §18.6, шаг 1). */
export const NEW_REPO_URL = `https://github.com/new?name=${DEFAULT_REPO}&visibility=private&description=${encodeURIComponent('Данные Kisr Library')}`;

/** Новый ключ: название, описание, бессрочный, право записи в содержимое. Репозиторий ссылкой не выбрать. */
export const NEW_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=Kisr%20Library' +
  `&description=${encodeURIComponent('Синхронизация Kisr Library: только репозиторий с данными')}` +
  '&expires_in=none&contents=write';

/** «Синхронизация» в «Ещё» (spec §18.6): включить, состояние, «сейчас», отключить. */
export function SyncSection() {
  const view = syncView.value;
  const [setup, setSetup] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const connected = (result: SyncResult | null) => {
    setSetup(false);
    // Книги с другого устройства синхронизация объявит сама
    if (!result?.added) toast('Синхронизация включена');
  };

  const disconnect = async () => {
    setConfirmOff(false);
    setBusy(true);
    try {
      await disconnectSync();
      toast('Синхронизация на этом устройстве выключена');
    } catch (error) {
      console.error('Не удалось отключить синхронизацию', error);
      toast('Не удалось отключить синхронизацию');
    } finally {
      setBusy(false);
    }
  };

  const syncing = view.phase === 'syncing';

  return (
    <Section title="Синхронизация">
      <div class="sset__card">
        {view.phase === 'off' ? (
          <div class="srow srow--stack">
            <span class="srow__text">
              <span class="srow__title">Синхронизация между устройствами</span>
              <span class="srow__sub">
                Книги, места чтения и отметки — одинаковые на телефоне и ноутбуке. Хранятся в твоём приватном репозитории на GitHub.
              </span>
            </span>
            <Button variant="primary" wide onClick={() => setSetup(true)}>
              Настроить
            </Button>
          </div>
        ) : (
          <>
            <div class="srow" role="status">
              <span class="srow__text">
                <span class="srow__title">Включена · {view.repo}</span>
                <span class={view.phase === 'error' ? 'srow__sub ssync__error' : 'srow__sub'}>{syncStatusLine(view, Date.now())}</span>
              </span>
            </div>
            {view.needsToken && (
              <button type="button" class="srow srow--button" onClick={() => setSetup(true)}>
                <span class="srow__text">
                  <span class="srow__title">Вставить новый ключ</span>
                </span>
                <Icon class="srow__icon" name="paste" size={20} />
              </button>
            )}
            <button type="button" class="srow srow--button" disabled={syncing || busy} onClick={() => void syncNow()}>
              <span class="srow__text">
                <span class="srow__title">Синхронизировать сейчас</span>
              </span>
              <Icon class="srow__icon" name="shuffle" size={20} />
            </button>
            <button type="button" class="srow srow--button" disabled={busy} onClick={() => setConfirmOff(true)}>
              <span class="srow__text">
                <span class="srow__title">Отключить на этом устройстве</span>
              </span>
            </button>
          </>
        )}
      </div>

      <Sheet open={setup} title="Синхронизация" onClose={() => setSetup(false)}>
        {setup && <SyncSetup initialRepo={view.repo ?? DEFAULT_REPO} onDone={connected} />}
      </Sheet>

      <Sheet open={confirmOff} title="Отключить синхронизацию?" onClose={() => setConfirmOff(false)}>
        <p class="sconfirm__what">Синхронизация на этом устройстве выключится.</p>
        <p class="sconfirm__rules">
          Книги останутся и здесь, и в репозитории. Ключ забудется: чтобы включить снова, его нужно будет вставить ещё раз.
        </p>
        <div class="sconfirm__actions">
          <Button variant="primary" wide disabled={busy} onClick={() => void disconnect()}>
            Отключить
          </Button>
          <Button wide onClick={() => setConfirmOff(false)}>
            Отмена
          </Button>
        </div>
      </Sheet>
    </Section>
  );
}

interface SyncSetupProps {
  initialRepo: string;
  onDone: (result: SyncResult | null) => void;
}

/** Три шага в шторке: репозиторий, ключ, «Подключить». */
function SyncSetup({ initialRepo, onDone }: SyncSetupProps) {
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState(initialRepo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const repoRef = useRef<HTMLInputElement>(null);

  // `autocorrect` и `spellcheck` — булевы свойства: через JSX строка "off" стала бы «вкл», а false снял бы атрибут. Ставим атрибуты напрямую.
  useLayoutEffect(() => {
    for (const el of [tokenRef.current, repoRef.current]) {
      el?.setAttribute('autocorrect', 'off');
      el?.setAttribute('spellcheck', 'false');
    }
  }, []);

  const connect = async (e?: Event) => {
    e?.preventDefault();
    if (busy || !token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await connectSync(token, repo);
      if (r.ok) onDone(r.result);
      else setError(r.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="ssync" onSubmit={(e) => void connect(e)}>
      <ol class="ssync__steps">
        <li>
          <b>Создай приватный репозиторий</b> с названием <code>{DEFAULT_REPO}</code>.{' '}
          <a href={NEW_REPO_URL} target="_blank" rel="noopener noreferrer">
            Открыть GitHub
          </a>
        </li>
        <li>
          <b>Создай ключ доступа:</b>{' '}
          <a href={NEW_TOKEN_URL} target="_blank" rel="noopener noreferrer">
            создать ключ
          </a>
          . В «Repository access» выбери «Only select repositories» и этот репозиторий — права и срок уже заполнены. Нажми «Generate token» и
          скопируй ключ.
        </li>
        <li>
          <b>Вставь ключ</b> и нажми «Подключить».
        </li>
      </ol>

      <label class="ssync__field">
        <span class="ssync__label">Ключ доступа</span>
        <input
          ref={tokenRef}
          class="ssync__input"
          type="password"
          name="token"
          autocomplete="off"
          autocapitalize="off"
          placeholder="github_pat_…"
          value={token}
          onInput={(e) => setToken(e.currentTarget.value)}
        />
      </label>
      <label class="ssync__field">
        <span class="ssync__label">Репозиторий</span>
        <input
          ref={repoRef}
          class="ssync__input"
          type="text"
          name="repo"
          autocomplete="off"
          autocapitalize="off"
          value={repo}
          onInput={(e) => setRepo(e.currentTarget.value)}
        />
      </label>

      {error && (
        <p class="snotice snotice--error ssync__notice" role="alert">
          {error}
        </p>
      )}

      <Button variant="primary" wide type="submit" disabled={busy || !token.trim()}>
        {busy ? 'Подключаю…' : 'Подключить'}
      </Button>

      <p class="ssync__note">
        Ключ хранится только на этом устройстве и не попадает в резервную копию. На втором устройстве повтори шаги 2 и 3 — или вставь тот же
        ключ.
      </p>
    </form>
  );
}
