// Tab Manager Pro — Welcome page script
document.addEventListener('DOMContentLoaded', () => {
  const actionsEl = document.getElementById('actions');
  const doneEl = document.getElementById('done');

  document.getElementById('enableAutoGroup').addEventListener('click', async () => {
    await applyChoice(true);
  });

  document.getElementById('skipAutoGroup').addEventListener('click', async () => {
    await applyChoice(false);
  });

  async function applyChoice(autoGroup) {
    try {
      const result = await chrome.storage.local.get('tabManagerSettings');
      const settings = result.tabManagerSettings || {};
      await chrome.storage.local.set({
        tabManagerSettings: { ...settings, autoGroup }
      });

      if (autoGroup) {
        // Kick off grouping in all open windows via the background SW
        chrome.runtime.sendMessage({ action: 'groupTabs' }).catch(() => {});
      }
    } catch (e) {
      console.error('Welcome: could not save setting', e);
    }

    actionsEl.style.display = 'none';
    doneEl.style.display = 'flex';
    setTimeout(() => window.close(), 2000);
  }
});
