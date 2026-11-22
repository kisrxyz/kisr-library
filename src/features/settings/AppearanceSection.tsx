import { useState } from 'preact/hooks';
import { settings, updateSettings } from '../../state/settings';
import { Icon } from '../../ui/Icon';
import { Segmented } from '../../ui/Segmented';
import { toast } from '../../ui/Toast';
import { ReaderSettingsSheet } from '../reader/ReaderSettingsSheet';
import { appearanceSummary, speedOptions } from './format';
import { Section } from './Section';

/**
 * «Внешний вид»: одна строка с краткой сводкой, нажатие открывает ту же шторку «Оформление», что и «Aa»
 * в читалке. Элементы управления не дублируются.
 */
export function AppearanceSection() {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Внешний вид">
      <div class="sset__card">
        <button type="button" class="srow srow--button" onClick={() => setOpen(true)}>
          <span class="srow__text">
            <span class="srow__title">Оформление текста</span>
            <span class="srow__sub">{appearanceSummary(settings.value)}</span>
          </span>
          <Icon class="srow__icon" name="right" size={20} />
        </button>
      </div>
      <ReaderSettingsSheet open={open} onClose={() => setOpen(false)} />
    </Section>
  );
}

/** «Чтение»: скорость, по которой считается время у книг. */
export function ReadingSection() {
  const { wpm } = settings.value;
  const change = (value: number) => {
    updateSettings({ wpm: value }).catch((error) => {
      console.error('Не удалось сохранить скорость чтения', error);
      toast('Не удалось сохранить');
    });
  };

  return (
    <Section title="Чтение">
      <div class="sset__card">
        <div class="srow srow--stack">
          <span class="srow__title">Скорость чтения, слов в минуту</span>
          <Segmented label="Скорость чтения, слов в минуту" options={speedOptions(wpm)} value={wpm} onChange={change} />
          <span class="srow__sub">Время у книг пересчитается</span>
        </div>
      </div>
    </Section>
  );
}
