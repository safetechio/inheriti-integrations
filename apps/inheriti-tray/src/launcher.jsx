import { createRoot } from 'react-dom/client';
import { LauncherApp } from './modules/launcher/ui/LauncherApp.jsx';
import { trayMessages } from './messages.ts';

createRoot(document.getElementById('root')).render(<LauncherApp messages={trayMessages} />);
