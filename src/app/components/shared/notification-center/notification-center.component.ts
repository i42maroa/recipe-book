import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { NotificationService } from '../../../services/notification.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-notification-center', standalone: true, imports: [AsyncPipe, IconComponent],
  templateUrl: './notification-center.component.html',
  styleUrl: './notification-center.component.css'
})
export class NotificationCenterComponent {
  private readonly notificationService = inject(NotificationService);
  readonly notifications$ = this.notificationService.notifications$;
  dismiss(id: number): void { this.notificationService.dismiss(id); }
}

