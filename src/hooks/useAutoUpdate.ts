import { useEffect, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { load } from '@tauri-apps/plugin-store';

const STORE_NAME = 'flomo-garden-settings.json';
const UPDATE_CHECK_INTERVAL = 1000 * 60 * 60; // 1 hour
const LAST_CHECK_KEY = 'lastUpdateCheck';
const AUTO_CHECK_KEY = 'autoCheckUpdates';

export function useAutoUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  useEffect(() => {
    checkForUpdatesIfNeeded();
  }, []);

  const checkForUpdatesIfNeeded = async () => {
    try {
      const store = await load(STORE_NAME, { autoSave: true });
      
      // Check if auto-update is enabled
      const autoCheckEnabled = await store.get<boolean>(AUTO_CHECK_KEY);
      if (autoCheckEnabled === false) {
        return;
      }

      // Check last update time
      const lastCheckTimestamp = await store.get<number>(LAST_CHECK_KEY);
      const now = Date.now();
      
      if (lastCheckTimestamp) {
        const timeSinceLastCheck = now - lastCheckTimestamp;
        if (timeSinceLastCheck < UPDATE_CHECK_INTERVAL) {
          return;
        }
      }

      // Perform update check
      const update = await check();
      setUpdateAvailable(!!update);
      setLastCheck(new Date(now));
      
      // Save last check time
      await store.set(LAST_CHECK_KEY, now);
      await store.save();
    } catch (error) {
      console.error('Failed to check for updates:', error);
    }
  };

  return {
    updateAvailable,
    lastCheck,
    checkForUpdatesIfNeeded,
  };
}