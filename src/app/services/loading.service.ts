import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly pending = signal<Record<string, number>>({});

  isLoading(section?: string): boolean {
    const pending = this.pending();
    return section ? (pending[section] ?? 0) > 0 : Object.values(pending).some((count) => count > 0);
  }

  /** Track logical operations without serializing independent requests. */
  async run<T>(operation: () => PromiseLike<T>, section = 'default'): Promise<T> {
    this.pending.set({ ...this.pending(), [section]: (this.pending()[section] ?? 0) + 1 });
    try { return await operation(); }
    finally {
      const next = { ...this.pending() };
      if (next[section] > 1) next[section]--;
      else delete next[section];
      this.pending.set(next);
    }
  }
}
