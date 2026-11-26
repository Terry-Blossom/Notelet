import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/tokens.css';
import './styles/base.css';
import './styles/note-screen.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="Notelet の画面表示中に予期しないエラーが発生しました">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
