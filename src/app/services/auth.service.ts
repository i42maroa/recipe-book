import { Injectable, inject, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService);
  private readonly currentUser = signal<User | null>(null);
  private readonly editor = signal(false);
  readonly user = this.currentUser.asReadonly();
  readonly canEdit = this.editor.asReadonly();
  private revision = 0;

  constructor() {
    this.supabase.client?.auth.onAuthStateChange((_event, session) => {
      // Auth callbacks must finish before making another Supabase request.
      const revision = ++this.revision;
      if (this.currentUser()?.id !== session?.user.id || !session) this.editor.set(false);
      this.currentUser.set(session?.user ?? null);
      setTimeout(() => {
        if (revision === this.revision) void this.checkPermission(session, revision);
      }, 0);
    });
  }

  private async checkPermission(session: Session | null, revision: number): Promise<boolean> {
    if (!session) return false;
    try {
      const { data, error } = await this.supabase.requireClient().rpc('is_recipe_editor');
      const allowed = !error && data === true;
      if (revision === this.revision) this.editor.set(allowed);
      return revision === this.revision && allowed;
    } catch {
      if (revision === this.revision) this.editor.set(false);
      return false;
    }
  }

  async refreshPermission(): Promise<boolean> {
    const { data, error } = await this.supabase.requireClient().auth.getSession();
    if (error) { this.editor.set(false); throw error; }
    const revision = ++this.revision;
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
