import { Injectable, inject } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { LoadingService } from './loading.service';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly loading = inject(LoadingService);
  readonly configured = Boolean(environment.supabaseUrl && environment.supabaseAnonKey);
  readonly client: SupabaseClient | null = this.configured
    ? createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      global: {
        fetch: (input, init) => this.loading.run(async () => {
          const response = await fetch(input, init);
          // Keep the lock until the complete response has arrived, not just its headers.
          await response.clone().arrayBuffer();
          return response;
        }),
      },
    })
    : null;

  requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Supabase no está configurado. Define supabaseUrl y supabaseAnonKey en environment.');
    return this.client;
  }
}
