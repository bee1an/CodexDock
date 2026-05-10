<script lang="ts">
  import AppDialog from '../AppDialog.svelte'

  export let onClose: () => void = () => {}
</script>

<AppDialog on:close={onClose}>
  <p>Dialog content</p>
</AppDialog>
