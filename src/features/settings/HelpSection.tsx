import type { ComponentChildren } from 'preact';
import { Section } from './Section';

function Help({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <details class="help">
      <summary class="help__summary">{title}</summary>
      <div class="help__body">{children}</div>
    </details>
  );
}

/** «Помощь»: три коротких раскрывающихся блока. */
export function HelpSection() {
  return (
    <Section title="Помощь">
      <Help title="Как добавить книгу из Claude">
        <ol class="help__steps">
          <li>Включи скилл (см. «Скилл для Claude» ниже) и напиши Claude: «Разбор для Kisr Library: тема».</li>
          <li>Нажми «Копировать» под ответом: весь ответ и есть книга.</li>
          <li>Открой «Добавить» и нажми «Вставить из буфера».</li>
        </ol>
        <p>
          Очень длинную книгу Claude может отдать файлом: выбери его в «Добавить». Если книга пришла частями, добавляй
          их по очереди, главы встанут в конец той же книги.
        </p>
      </Help>

      <Help title="Как установить на iPhone">
        <ol class="help__steps">
          <li>Открой сайт библиотеки в Safari.</li>
          <li>Нажми «Поделиться».</li>
          <li>Выбери «На экран „Домой“».</li>
          <li>Дальше открывай приложение с экрана «Домой».</li>
        </ol>
        <p class="help__warn">
          <b>Важно:</b> книги, добавленные во вкладке Safari, в установленном приложении не видны: у них разные
          хранилища. Добавляй книги и восстанавливай копию уже внутри установленного приложения.
        </p>
      </Help>

      <Help title="Скилл для Claude">
        <p>
          Скилл — это готовая инструкция для Claude. С ним Claude сам пишет книгу в том формате, который понимает
          приложение: с главами, карточками и заданиями.
        </p>
        <p>
          Файл лежит в проекте: <code>claude-skill/kisr-library-razbor.zip</code>. Загрузи его в claude.ai: «Настройки» →
          «Возможности» → «Навыки». После этого просьба «Разбор для Kisr Library: тема» даёт книгу, которую можно
          вставить в «Добавить».
        </p>
      </Help>
    </Section>
  );
}
