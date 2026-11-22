import { needUpdate, updateApp } from '../../pwa';
import { Button } from '../../ui/Button';
import { Section } from './Section';
import { APP_VERSION } from './version';

/** «О приложении»: версия и, если новая версия уже скачана, кнопка обновления. */
export function AboutSection() {
  return (
    <Section title="О приложении">
      <div class="sset__card">
        <p class="srow">Kisr Library · версия {APP_VERSION}</p>
        {needUpdate.value && (
          <div class="srow srow--between">
            <span>Доступна новая версия</span>
            <Button variant="primary" onClick={updateApp}>
              Обновить приложение
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
