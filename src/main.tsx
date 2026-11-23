import { render } from 'solid-js/web';
import './styles.css';
import { installRunners } from './ui/workers';
import { App } from './ui/App';

installRunners();
render(() => <App />, document.getElementById('root')!);

// Offline support: once the page has loaded, a service worker keeps a copy of the app's files so that Nodal
// opens without a connection and can be installed like an app. It is left out during automated tests.
if ('serviceWorker' in navigator && import.meta.env.PROD && !navigator.webdriver && !new URLSearchParams(location.search).has('embed')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline use is simply unavailable */ }); });
}
