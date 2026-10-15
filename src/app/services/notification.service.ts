import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface AppNotification {
  id: number;
  message: string;
  kind: 'success' | 'error';
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly notificationsSubject = new BehaviorSubject<AppNotification[]>([]);
  readonly notifications$ = this.notificationsSubject.asObservable();
  private nextId = 0;

  success(message: string): void { this.add(message, 'success'); }
  error(message: string): void { this.add(message, 'error'); }

  dismiss(id: number): void {
    this.notificationsSubject.next(this.notificationsSubject.value.filter((item) => item.id !== id));
  }

  private add(message: string, kind: AppNotification['kind']): void {
    const id = ++this.nextId;
    this.notificationsSubject.next([...this.notificationsSubject.value, { id, message, kind }]);
    window.setTimeout(() => this.dismiss(id), 3600);
  }
}

