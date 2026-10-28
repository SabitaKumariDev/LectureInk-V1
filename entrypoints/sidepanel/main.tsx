import { createRoot } from 'react-dom/client';
import App from './App';
import { engine } from './engine';
import './styles.css';

// Excalidraw loads its fonts from here (copied into public/fonts on install), not a CDN.
(window as any).EXCALIDRAW_ASSET_PATH = '/';

engine.start();
createRoot(document.getElementById('root')!).render(<App />);
