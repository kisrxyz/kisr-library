import { TopBar } from '../../ui/TopBar';
import { AboutSection } from './AboutSection';
import { AppearanceSection, ReadingSection } from './AppearanceSection';
import { DataSection } from './DataSection';
import { HelpSection } from './HelpSection';
import { StatsSection } from './StatsSection';
import './settings.css';

/** «Ещё» (spec §10.7): внешний вид, чтение, данные, статистика, помощь, о приложении. */
export function SettingsScreen() {
  return (
    <>
      <TopBar title="Ещё" />
      <main class="screen settings">
        <AppearanceSection />
        <ReadingSection />
        <DataSection />
        <StatsSection />
        <HelpSection />
        <AboutSection />
      </main>
    </>
  );
}
