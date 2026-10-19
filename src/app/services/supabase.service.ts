import { Injectable, inject } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { CacheService } from './cache.service';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly cache = inject(CacheService);
  readonly configured = Boolean(environment.supabaseUrl && environment.supabaseAnonKey);
  readonly client: SupabaseClient | null = this.configured
    ? createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: this.cache.createStorage(environment.sessionCacheTtlMs),
      },
    })
    : null;

  requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Supabase no está configurado. Define supabaseUrl y supabaseAnonKey en environment.');
    return this.client;
  }
}
