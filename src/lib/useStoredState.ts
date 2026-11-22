import { useEffect, useState } from 'react';

/** useState that remembers its value in localStorage (best effort). */
export function useStoredState<T extends object>(key: string, initial: T): [T, (patch: Partial<T>) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return { ...initial, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      // Storage unavailable or corrupt; fall back to defaults.
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore quota / privacy-mode errors.
    }
  }, [key, value]);

  return [value, (patch) => setValue((v) => ({ ...v, ...patch }))];
}
