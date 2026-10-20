import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUser = signal<User | null>(null);
  private readonly editor = signal(false);
  readonly user = this.currentUser.asReadonly();
  readonly canEdit = this.editor.asReadonly();
  private revision = 0;
  private permissionTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor() {
    const client = this.supabase.client;
    if (!client) return;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      // Auth callbacks must finish before making another Supabase request.
      const revision = ++this.revision;
      if (this.currentUser()?.id !== session?.user.id || !session) this.editor.set(false);
      this.currentUser.set(session?.user ?? null);
      clearTimeout(this.permissionTimer);
      this.permissionTimer = setTimeout(() => {
        if (session && revision === this.revision) void this.refreshPermission().catch(() => undefined);
      }, 0);
    });

    // Mobile browsers suspend background tabs. Re-read/refresh the SDK session
    // and permissions when returning, without reloading or starting Google again.
    const restore = (): void => {
      if (this.document.visibilityState === 'hidden') return;
      void this.refreshPermission().catch(() => undefined);
    };
    const view = this.document.defaultView;
    this.document.addEventListener('visibilitychange', restore);
    view?.addEventListener('pageshow', restore);
    view?.addEventListener('focus', restore);
    view?.addEventListener('online', restore);
    this.destroyRef.onDestroy(() => {
      subscription.unsubscribe();
      clearTimeout(this.permissionTimer);
      this.document.removeEventListener('visibilitychange', restore);
      view?.removeEventListener('pageshow', restore);
      view?.removeEventListener('focus', restore);
      view?.removeEventListener('online', restore);
    });
    restore();
  }

  private async checkPermission(session: Session | null, revision: number): Promise<boolean> {
    if (!session) return false;
    const { data, error } = await this.supabase.requireClient().rpc('is_recipe_editor');
    // A failed check blocks the operation, but does not revoke a previously
    // verified session or destroy its unsaved work. Only a response can revoke it.
    if (error) throw error;
    const allowed = data === true;
    if (revision === this.revision) this.editor.set(allowed);
    return revision === this.revision && allowed;
  }

  refreshPermission(): Promise<boolean> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.loadSessionAndPermission().finally(() => { this.refreshInFlight = null; });
    }
    return this.refreshInFlight;
  }

  private async loadSessionAndPermission(): Promise<boolean> {
    const startingRevision = this.revision;
    const { data, error } = await this.supabase.requireClient().auth.getSession();
    if (error) throw error;
    if (startingRevision !== this.revision && data.session?.user.id !== this.currentUser()?.id) return false;
    const revision = ++this.revision;
    if (this.currentUser()?.id !== data.session?.user.id) this.editor.set(false);
    this.currentUser.set(data.session?.user ?? null);
    if (!data.session) this.editor.set(false);
    return this.checkPermission(data.session, revision);
  }

  async requireEditor(): Promise<void> {
    if (!await this.refreshPermission()) {
      throw new Error('Necesitas una sesión de un usuario autorizado para modificar el recetario.');
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.supabase.requireClient().auth.signInWithPassword({ email, password });
    if (error) throw new Error('No se pudo iniciar sesión. Comprueba el correo y la contraseña.');
    await this.refreshPermission();
  }

  async signInWithGoogle(): Promise<void> {
    const { error } = await this.supabase.requireClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/login` },
    });
    if (error) throw new Error('No se pudo iniciar sesión con Google. Inténtalo de nuevo.');
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.requireClient().auth.signOut({ scope: 'local' });
    if (error) throw error;
    ++this.revision;
    this.editor.set(false);
    this.currentUser.set(null);
  }
}
