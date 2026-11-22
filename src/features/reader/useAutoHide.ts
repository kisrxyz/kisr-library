/**
 * Панель и плашка читалки прячутся при прокрутке вниз и появляются при прокрутке вверх, у начала
 * и у конца главы (spec §8.1). Двигаются только `transform` (reader.css); при `prefers-reduced-motion`
 * переходы выключены глобально (base.css). Прокрутки, сделанные самим приложением (восстановление
 * места, переход к блоку), панель не дёргают.
 */
import { useEffect, useState } from 'preact/hooks';

/** У самого верха страницы панель всегда видна. */
const TOP_EDGE = 80;
/** Столько пикселей подряд в одну сторону, прежде чем панель спрячется или покажется. */
const STEP = 12;
/** Прокрутка, которую сделало приложение: её событие приходит чуть позже вызова. */
const PROGRAMMATIC_MS = 200;

let programmatic: { y: number; until: number } | null = null;

/** Прокрутить окно «от приложения»: панель на это не реагирует, а позиция не считается выбранной читателем. */
export function scrollWindowTo(y: number): void {
  window.scrollTo(0, y);
  // Браузер мог упереться в край страницы — запоминаем, где окно оказалось на самом деле
  programmatic = { y: window.scrollY, until: performance.now() + PROGRAMMATIC_MS };
}

/**
 * Текущая прокрутка сделана приложением (`scrollWindowTo`), а не читателем: окно стоит там, куда его
 * поставили, и это было только что. Если читатель успел сдвинуть страницу — прокрутка уже его.
 */
export function isProgrammaticScroll(): boolean {
  if (!programmatic) return false;
  if (performance.now() > programmatic.until) {
    programmatic = null;
    return false;
  }
  return Math.abs(window.scrollY - programmatic.y) < 2;
}

/**
 * Видна ли панель. Пока `enabled` ложно (глава ещё открывается), панель видна и прокрутка не слушается.
 * `nearEnd` — конец главы уже в кадре: там панель тоже показывается.
 */
export function useAutoHide(enabled: boolean, nearEnd: () => boolean): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    if (!enabled) return;
    let lastY = window.scrollY;
    let run = 0;
    let frame = 0;

    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;
      if (isProgrammaticScroll()) {
        run = 0;
        return;
      }
      const bottom = document.documentElement.scrollHeight - window.innerHeight;
      if (y <= TOP_EDGE || y >= bottom - TOP_EDGE || nearEnd()) {
        run = 0;
        setVisible(true);
        return;
      }
      // Копим путь в одну сторону; смена направления начинает отсчёт заново
      run = dy === 0 ? run : Math.sign(dy) === Math.sign(run) ? run + dy : dy;
      if (run > STEP) setVisible(false);
      else if (run < -STEP) setVisible(true);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return visible;
}
