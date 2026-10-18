import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/notification.service';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-user-session',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  templateUrl: './user-session.component.html',
  styleUrl: './user-session.component.css',
})
export class UserSessionComponent {
  readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  readonly signingOut = signal(false);

  async signOut(): Promise<void> {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.auth.signOut();
      this.notifications.success('Sesión cerrada.');
    } catch {
      this.notifications.error('No se pudo cerrar la sesión. Inténtalo de nuevo.');
    } finally {
      this.signingOut.set(false);
    }
  }
}
