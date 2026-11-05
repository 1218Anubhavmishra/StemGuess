import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import EqualizerBackground from './components/EqualizerBackground';
import Splash from './components/Splash';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EqualizerBackground />
    <App />
    <Splash />
  </StrictMode>,
);
