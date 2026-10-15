import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly configured = Boolean(environment.supabaseUrl && environment.supabaseAnonKey);
  readonly client: SupabaseClient | null = this.configured
    ? createClient(environment.supabaseUrl, environment.supabaseAnonKey)
    : null;

  requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Supabase no está configurado. Define supabaseUrl y supabaseAnonKey en environment.');
    return this.client;
  }
}
