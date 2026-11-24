import { TopBar } from '../../ui/TopBar';
import { AboutSection } from './AboutSection';
import { AppearanceSection, ReadingSection } from './AppearanceSection';
import { DataSection } from './DataSection';
import { HelpSection } from './HelpSection';
import { StatsSection } from './StatsSection';
import { SyncSection } from './SyncSection';
import './settings.css';

/** «Ещё» (spec §10.7): внешний вид, чтение, синхронизация (§18.6), данные, статистика, помощь, о приложении. */
export function SettingsScreen() {
  return (
    <>
      <TopBar title="Ещё" />
      <main class="screen settings">
        <AppearanceSection />
        <ReadingSection />
        <SyncSection />
        <DataSection />
        <StatsSection />
        <HelpSection />
        <AboutSection />
      </main>
    </>
  );
}
