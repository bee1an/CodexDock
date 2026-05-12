<script lang="ts">
  import AppDialog from '../AppDialog.svelte'

  export let onClose: () => void = () => {}
  export let title = ''
  export let closeDisabled = false
</script>

<AppDialog {title} {closeDisabled} showClose closeLabel="Close" on:close={onClose}>
  <p>Dialog content</p>
  <svelte:fragment slot="footer">
    <button type="button">Footer action</button>
  </svelte:fragment>
</AppDialog>
