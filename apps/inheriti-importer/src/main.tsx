import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/App';
import '@/styles.css';
import { ImporterRuntime } from '@/ImporterRuntime';
import { ErrorBoundary } from '@shared/ui/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ImporterRuntime>
        <App />
      </ImporterRuntime>
    </ErrorBoundary>
  </React.StrictMode>,
);
