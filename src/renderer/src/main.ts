import { mount } from 'svelte'
import 'normalize.css'
import 'virtual:uno.css'

const params = new URLSearchParams(window.location.search)
const view = params.get('view')

const app = await (async () => {
  if (view === 'upgrade-progress') {
    const { default: UpgradeProgress } = await import('./views/upgrade/UpgradeProgress.svelte')
    return mount(UpgradeProgress, {
      target: document.getElementById('app')!
    })
  }

  await import('./assets/main.css')
  await import('./assets/app-theme-overrides.css')
  await import('./assets/prompts-view.css')
  await import('./assets/skill-library-view.css')
  await import('./assets/cost-stats-view.css')
  await import('./assets/sessions-view.css')
  await import('./assets/accounts-list-view.css')
  await import('./assets/local-gateway-view.css')
  const { default: App } = await import('./App.svelte')
  return mount(App, {
    target: document.getElementById('app')!
  })
})()

export default app
