import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BaseFormComponent } from './components/shared/base-form/base-form.component';
import { BreadcrumbComponent } from './components/shared/breadcrumb/breadcrumb.component';
import { NavbarComponent } from './components/shared/navbar/navbar.component';
import { NotificationCenterComponent } from './components/shared/notification-center/notification-center.component';
import { FormService } from './services/form.service';
import { PageMetadataService } from './services/page-metadata.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, RouterOutlet, BaseFormComponent, NavbarComponent, BreadcrumbComponent, NotificationCenterComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly forms = inject(FormService);

  constructor() { inject(PageMetadataService); }
}

