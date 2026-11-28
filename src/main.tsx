import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { t } from './i18n';
import './styles/tokens.css';
import './styles/base.css';
import './styles/note-screen.css';
import './styles/mobile.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle={t('Notelet の画面表示中に予期しないエラーが発生しました')}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
