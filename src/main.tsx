import { render } from 'solid-js/web';
import './styles.css';
import { installRunners } from './ui/workers';
import { App } from './ui/App';

installRunners();
render(() => <App />, document.getElementById('root')!);
