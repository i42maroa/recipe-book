import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

interface CacheEntry<T> {
  version: 1;
  value: T;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class CacheService {
  private readonly document = inject(DOCUMENT);
  private readonly prefix = 'laurel:cache:';
  // Keep the current tab usable if the browser blocks localStorage or is full.
  private readonly fallback = new Map<string, string>();

  get<T>(key: string): T | null {
    const storageKey = this.prefix + key;
    let raw = this.fallback.get(storageKey) ?? null;
    if (raw === null) {
      try { raw = this.document.defaultView?.localStorage.getItem(storageKey) ?? null; }
      catch { return null; }
    }
    if (raw === null) return null;
    try {
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (!entry || entry.version !== 1 || !Object.hasOwn(entry, 'value') ||
        !Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now()) {
        this.remove(key);
        return null;
      }
      return entry.value;
    } catch {
      this.remove(key);
      return null;
    }
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new RangeError('La duración de la caché debe ser un número de milisegundos no negativo.');
    if (ttlMs === 0) { this.remove(key); return; }
    const raw = JSON.stringify({ version: 1, value, expiresAt: Date.now() + ttlMs });
    const storageKey = this.prefix + key;
    try {
      const storage = this.document.defaultView?.localStorage;
      if (!storage) throw new Error('Almacenamiento no disponible');
      storage.setItem(storageKey, raw);
      this.fallback.delete(storageKey);
    } catch {
      this.fallback.set(storageKey, raw);
    }
  }

  remove(key: string): void {
    const storageKey = this.prefix + key;
    this.fallback.delete(storageKey);
    try { this.document.defaultView?.localStorage.removeItem(storageKey); }
    catch { /* Storage can be unavailable in private or restricted contexts. */ }
  }

  /** String storage compatible with Supabase, including one-time legacy migration. */
  createStorage(ttlMs: number) {
    return {
      getItem: (key: string): string | null => {
        const cached = this.get<unknown>(key);
        if (typeof cached === 'string') return cached;
        // Preserve sessions saved by Supabase before CacheService was introduced.
        let legacy: string | null = null;
        try { legacy = this.document.defaultView?.localStorage.getItem(key) ?? null; }
        catch { return null; }
        if (legacy !== null) {
          this.set(key, legacy, ttlMs);
          this.removeLegacy(key);
        }
        return legacy;
      },
      setItem: (key: string, value: string): void => {
        this.set(key, value, ttlMs);
        this.removeLegacy(key);
      },
      removeItem: (key: string): void => {
        this.remove(key);
        this.removeLegacy(key);
      },
    };
  }

  private removeLegacy(key: string): void {
    try { this.document.defaultView?.localStorage.removeItem(key); }
    catch { /* The in-memory fallback remains available for this tab. */ }
  }
}
