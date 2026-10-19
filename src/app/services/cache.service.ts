import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

interface CacheEntry<T> {
  version: 1;
  value: T;
  expiresAt: number;
  writtenAt?: number;
  kind?: 'data' | 'session';
}

@Injectable({ providedIn: 'root' })
export class CacheService {
  private readonly document = inject(DOCUMENT);
  private readonly prefix = 'laurel:cache:';
  // Keep the current tab usable if the browser blocks localStorage or is full.
  private readonly fallback = new Map<string, string>();
  private readonly maxEntries = 80;
  private readonly maxBytes = 2 * 1024 * 1024;

  constructor() { this.prune(); }

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
    this.write(key, value, ttlMs, 'data');
  }

  private write<T>(key: string, value: T, ttlMs: number, kind: 'data' | 'session'): void {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new RangeError('La duración de la caché debe ser un número de milisegundos no negativo.');
    if (ttlMs === 0) { this.remove(key); return; }
    this.prune();
    const raw = JSON.stringify({ version: 1, value, expiresAt: Date.now() + ttlMs, writtenAt: Date.now(), kind });
    const storageKey = this.prefix + key;
    try {
      const storage = this.document.defaultView?.localStorage;
      if (!storage) throw new Error('Almacenamiento no disponible');
      storage.setItem(storageKey, raw);
      this.fallback.delete(storageKey);
    } catch (error) {
      // Free our data first when the quota is full. Never evict the auth session.
      if ((error as { name?: string })?.name === 'QuotaExceededError') {
        this.clearData();
        try {
          this.document.defaultView!.localStorage.setItem(storageKey, raw);
          this.fallback.delete(storageKey);
        } catch { this.fallback.set(storageKey, raw); }
      } else this.fallback.set(storageKey, raw);
    }
    this.prune();
  }

  /** Only application data; sessions and unrelated localStorage entries survive. */
  clearData(): void {
    for (const entry of this.dataEntries()) this.remove(entry.key);
  }

  private dataEntries(): { key: string; raw: string; expiresAt: number; writtenAt: number }[] {
    const entries = new Map<string, string>();
    try {
      const storage = this.document.defaultView?.localStorage;
      if (storage) for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(this.prefix)) entries.set(key, storage.getItem(key) ?? '');
      }
    } catch { /* Use the bounded memory fallback when storage is blocked. */ }
    for (const [key, raw] of this.fallback) entries.set(key, raw);
    const data: { key: string; raw: string; expiresAt: number; writtenAt: number }[] = [];
    for (const [storageKey, raw] of entries) {
      const key = storageKey.slice(this.prefix.length);
      // Includes Supabase session keys written before the kind field existed.
      if (key.startsWith('sb-')) continue;
      try {
        const entry = JSON.parse(raw) as CacheEntry<unknown>;
        if (entry.kind === 'session') continue;
        if (entry.version !== 1 || !Number.isFinite(entry.expiresAt)) { this.remove(key); continue; }
        data.push({ key, raw, expiresAt: entry.expiresAt, writtenAt: entry.writtenAt ?? entry.expiresAt });
      } catch { this.remove(key); }
    }
    return data;
  }

  private prune(): void {
    const entries = this.dataEntries().filter((entry) => {
      if (entry.expiresAt > Date.now()) return true;
      this.remove(entry.key);
      return false;
    }).sort((a, b) => a.writtenAt - b.writtenAt);
    let bytes = entries.reduce((total, entry) => total + 2 * (entry.raw.length + entry.key.length + this.prefix.length), 0);
    let count = entries.length;
    for (const entry of entries) {
      if (count <= this.maxEntries && bytes <= this.maxBytes) break;
      this.remove(entry.key);
      count--;
      bytes -= 2 * (entry.raw.length + entry.key.length + this.prefix.length);
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
          this.write(key, legacy, ttlMs, 'session');
          this.removeLegacy(key);
        }
        return legacy;
      },
      setItem: (key: string, value: string): void => {
        this.write(key, value, ttlMs, 'session');
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
