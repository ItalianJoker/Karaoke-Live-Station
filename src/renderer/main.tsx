import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { App } from './App';

// Global anomaly interceptors capturing uncaught runtime errors and promise rejections
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const errorDetails = {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack || event.error
    };
    window.karaokeApi?.logger?.log('error', 'Renderer:WindowError', event.message, errorDetails);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const errorDetails = {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined
    };
    window.karaokeApi?.logger?.log('error', 'Renderer:UnhandledRejection', 'Unhandled Promise Rejection', errorDetails);
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
