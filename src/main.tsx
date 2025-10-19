import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/tailwind.css';
import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({ immediate: true });

if (import.meta.hot) {
  import.meta.hot.accept(() => updateSW?.());
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
