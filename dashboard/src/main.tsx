import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { installDesktopDialogFocusFix } from './lib/desktopDialogFocus';
import './styles.css';

installDesktopDialogFocusFix();

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (favicon) {
  favicon.href = import.meta.env.DEV ? '/favicon-dev.svg' : '/favicon.svg';
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
