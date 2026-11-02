import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installBuildStamp } from './buildStamp';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemen #root tidak ada di index.html.');
installBuildStamp(root);
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
