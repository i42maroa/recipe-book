import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.css',
})
export class LoginPageComponent {
  readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  constructor() {
    const callback = this.route.snapshot;
    const fragment = new URLSearchParams(callback.fragment ?? '');
    if (callback.queryParamMap.has('error') || fragment.has('error')) {
      this.error.set('No se completó el acceso con Google. Puedes volver a intentarlo.');
    }
  }

  async signInWithGoogle(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try { await this.auth.signInWithGoogle(); }
    catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo iniciar sesión con Google.');
    } finally { this.busy.set(false); }
  }

  async signIn(): Promise<void> {
    if (this.busy()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.busy.set(true);
    this.error.set('');
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.signIn(email.trim(), password);
      this.form.controls.password.reset();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    } finally { this.busy.set(false); }
  }

  async signOut(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try { await this.auth.signOut(); }
    catch { this.error.set('No se pudo cerrar la sesión. Inténtalo de nuevo.'); }
    finally { this.busy.set(false); }
  }

  async refreshPermission(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try { await this.auth.refreshPermission(); }
    catch { this.error.set('No se pudieron comprobar los permisos.'); }
    finally { this.busy.set(false); }
  }
}
