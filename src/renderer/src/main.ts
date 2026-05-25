import { mount } from 'svelte'
import 'normalize.css'
import 'virtual:uno.css'
import './assets/main.css'
import './assets/app-theme-overrides.css'
import './assets/prompts-view.css'
import './assets/skill-library-view.css'
import './assets/cost-stats-view.css'
import './assets/sessions-view.css'
import './assets/accounts-list-view.css'
import './assets/local-gateway-view.css'

import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!
})

export default app
