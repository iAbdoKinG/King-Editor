import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app/App';
import { bootstrap } from './app/bootstrap';
import { registerServiceWorker } from './app/pwa';
import { initTheme } from './app/theme';
import { initLang, useLangStore } from './i18n';

/** Remount the UI when the language changes (project and media state live outside React). */
function Root() {
  const lang = useLangStore((s) => s.lang);
  return <App key={lang} />;
}

initTheme();
initLang();
bootstrap();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
registerServiceWorker();
