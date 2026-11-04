import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Splash from './components/Splash';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Splash />
  </StrictMode>,
);
