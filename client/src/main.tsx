import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyStyle, loadLastAppliedStyle } from './styleThemes';
import './styles.css';

const savedTheme = window.localStorage.getItem('hr-report-theme');
if (savedTheme === 'dark') {
  document.documentElement.dataset.theme = 'dark';
}

// Apply the last style used on this device before the first paint so the
// sign-in screen renders with the chosen look (no flash of the default).
applyStyle(loadLastAppliedStyle());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
