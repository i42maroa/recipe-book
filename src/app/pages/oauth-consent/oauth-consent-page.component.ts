import { Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { LoginPageComponent } from '../login/login-page.component';
import { ButtonComponent } from '../../components/shared/button/button.component';

@Component({
  selector: 'app-oauth-consent-page', standalone: true,
  imports: [RouterLink, LoginPageComponent, ButtonComponent],
  templateUrl: './oauth-consent-page.component.html', styleUrl: './oauth-consent-page.component.css',
})
export class OAuthConsentPageComponent {
  readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private readonly route = inject(ActivatedRoute);
  readonly details = signal<OAuthAuthorizationDetails | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly authorizationId = this.route.snapshot.queryParamMap.get('authorization_id') ?? '';
  private revision = 0;
  private consentOwner: string | null | undefined;
  private consentEditor = false;

  constructor() {
    effect(() => {
      const owner = this.auth.user()?.id ?? null;
      const editor = this.auth.canEdit();
      // Refreshing the same user's permission must not cancel their decision.
      if (owner === this.consentOwner && editor === this.consentEditor) return;
      this.consentOwner = owner;
      this.consentEditor = editor;
      const revision = ++this.revision;
      this.details.set(null);
      this.busy.set(false);
      this.error.set('');
      if (owner && editor) void this.load(revision);
    });
  }

  private async load(revision: number): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.authorizationId)) {
      this.error.set('La solicitud de conexión no es válida. Iníciala de nuevo desde tu asistente.'); return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const { data, error } = await this.supabase.requireClient().auth.oauth.getAuthorizationDetails(this.authorizationId);
      if (revision !== this.revision) return;
      if (error || !data) throw new Error('No se pudo recuperar la solicitud. Puede haber caducado; inicia de nuevo la conexión.');
      if ('redirect_url' in data) this.redirect(data.redirect_url);
      else this.details.set(data);
    } catch (error) {
      if (revision === this.revision) this.error.set(error instanceof Error ? error.message : 'No se pudo cargar la solicitud.');
    } finally { if (revision === this.revision) this.busy.set(false); }
  }

  async decide(approve: boolean): Promise<void> {
    if (this.busy() || !this.details()) return;
    const revision = this.revision;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.requireEditor();
      if (revision !== this.revision) return;
      const oauth = this.supabase.requireClient().auth.oauth;
      const { data, error } = approve
        ? await oauth.approveAuthorization(this.authorizationId, { skipBrowserRedirect: true })
        : await oauth.denyAuthorization(this.authorizationId, { skipBrowserRedirect: true });
      if (revision !== this.revision) return;
      if (error || !data) throw new Error('No se pudo completar la autorización. Inténtalo de nuevo.');
      this.redirect(data.redirect_url);
    } catch (error) {
      if (revision === this.revision) this.error.set(error instanceof Error ? error.message : 'No se pudo completar la autorización.');
    } finally { if (revision === this.revision) this.busy.set(false); }
  }

  private redirect(value: string): void {
    // Redirects come exclusively from Supabase's registered-client validation.
    const target = new URL(value);
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))) {
      throw new Error('La dirección de retorno no es válida.');
    }
    window.location.assign(target.href);
  }
}
