import { useCallback, useEffect, useState } from "react";
import type { FilterState } from "../types";

export interface SavedFilter {
  id: string;
  name: string;
  filters: FilterState;
}

const KEY = "logcat-saved-filters-v1";

function load(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d)) {
        const out: SavedFilter[] = [];
        for (const item of d) {
          if (
            item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            item.filters &&
            typeof item.filters === "object"
          ) {
            out.push(item as SavedFilter);
          }
        }
        return out;
      }
    }
  } catch {
    // 忽略损坏的缓存
  }
  return [];
}

export function useSavedFilters() {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(savedFilters));
    } catch {
      // 忽略写入失败
    }
  }, [savedFilters]);

  const saveFilter = useCallback((name: string, filters: FilterState): string => {
    const n = name.trim();
    if (!n) return "";
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setSavedFilters((list) => [...list, { id, name: n, filters }]);
    return id;
  }, []);

  const deleteFilter = useCallback((id: string) => {
    setSavedFilters((list) => list.filter((f) => f.id !== id));
  }, []);

  return { savedFilters, saveFilter, deleteFilter };
}
