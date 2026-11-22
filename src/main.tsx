import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app/App';
import { bootstrap } from './app/bootstrap';
import { registerServiceWorker } from './app/pwa';

bootstrap();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerServiceWorker();
