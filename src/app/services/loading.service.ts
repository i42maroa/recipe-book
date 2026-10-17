import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly loading = signal(false);
  private pending = 0;
  private queue: Promise<void> = Promise.resolve();

  isLoading(): boolean {
    return this.loading();
  }

  /** Queue network calls so only one request can run at a time. */
  run<T>(operation: () => Promise<T>): Promise<T> {
    this.pending++;
    this.loading.set(true);

    const result = this.queue.then(operation).finally(() => {
      this.pending--;
      this.loading.set(this.pending > 0);
    });

    // A failed request must not prevent subsequent requests from running.
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
