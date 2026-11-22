/**
 * Заглушка обновления приложения. Настоящую (vite-plugin-pwa: `registerSW`, ожидающий service worker)
 * делает задача 13 и заменит этот файл; интерфейс остаётся тем же.
 */
import { signal } from '@preact/signals';

/** Новая версия скачана и ждёт нажатия «Обновить». */
export const needUpdate = signal(false);

/** Применить ожидающую версию. Пока service worker нет — просто перезагрузка. */
export const updateApp = (): void => location.reload();
