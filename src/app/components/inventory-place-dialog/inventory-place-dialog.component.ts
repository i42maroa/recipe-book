import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, viewChild } from '@angular/core';
import { InventoryService } from '../../services/inventory.service';
import { lockDialogScroll } from '../../utils/dialog-scroll.utils';
import { IconComponent } from '../shared/icon/icon.component';

@Component({
  selector: 'app-inventory-place-dialog', standalone: true,
  imports: [IconComponent],
  templateUrl: './inventory-place-dialog.component.html',
  styleUrl: './inventory-place-dialog.component.css',
})
export class InventoryPlaceDialogComponent {
  readonly disabled = input(false);
  readonly returnFocus = input<HTMLElement | null>(null);
  readonly closed = output<void>();
  readonly selected = output<string>();
  readonly createRequested = output<void>();
  readonly renameRequested = output<void>();
  readonly removeRequested = output<void>();
  readonly retryRequested = output<void>();
  readonly reloadRequested = output<void>();
  readonly inventory = inject(InventoryService);
  readonly cannotModify = computed(() => this.disabled() || !this.inventory.ready() || this.inventory.loading() || !!this.inventory.error());
  private readonly document = inject(DOCUMENT);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    const previousFocus = this.document.activeElement as HTMLElement | null;
    const releaseScroll = lockDialogScroll(this.document);
    afterNextRender(() => this.dialog().nativeElement.showModal());
    inject(DestroyRef).onDestroy(() => {
      this.dialog().nativeElement.close();
      releaseScroll();
      const previous = this.returnFocus() ?? previousFocus;
      const target = previous?.isConnected && !previous.matches(':disabled') ? previous
        : this.document.querySelector<HTMLElement>('.menu-toggle');
      target?.focus({ preventScroll: true });
    });
  }

  close(event?: Event): void {
    event?.preventDefault();
    if (!this.disabled()) this.closed.emit();
  }
}
