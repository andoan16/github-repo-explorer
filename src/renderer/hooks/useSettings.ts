import { useState, useEffect, useCallback } from 'react';
import type { AppSettings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.repoExplorer.getSettings().then((res) => {
      if (res.ok && res.data) setSettings(res.data);
      setLoading(false);
    });
  }, []);

  const saveSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial };
    const res = await window.repoExplorer.saveSettings(updated);
    if (res.ok) setSettings(updated);
    return res.ok;
  }, [settings]);

  return { settings, loading, saveSettings };
}
