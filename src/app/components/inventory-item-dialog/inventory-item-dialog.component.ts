import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, input, output, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { InventoryItem } from '../../models/inventory.model';
import { InventoryService } from '../../services/inventory.service';
import { InventoryPlanningService } from '../../services/inventory-planning.service';
import { InventoryIngredientPlanningService } from '../../services/inventory-ingredient-planning.service';
import { inventoryGroupTotal, InventoryItemGroup } from '../../utils/inventory-groups.utils';
import { inventoryAmountLabel } from '../../utils/inventory.utils';
import { ingredientCategoryLabel } from '../../utils/recipe-display.utils';
import { lockDialogScroll } from '../../utils/dialog-scroll.utils';
import { IconComponent } from '../shared/icon/icon.component';

@Component({
  selector: 'app-inventory-item-dialog', standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './inventory-item-dialog.component.html',
  styleUrl: './inventory-item-dialog.component.css',
})
export class InventoryItemDialogComponent {
  readonly group = input.required<InventoryItemGroup>();
  readonly placeName = input.required<string>();
  readonly placeId = input.required<string>();
  readonly spaceLabel = input.required<string>();
  readonly disabled = input(false);
  readonly returnFocus = input<HTMLElement | null>(null);
  readonly closed = output<void>();
  readonly editRequested = output<InventoryItem>();
  readonly withdrawRequested = output<InventoryItem>();
  readonly retryRequested = output<void>();
  readonly reloadRequested = output<void>();
  readonly inventory = inject(InventoryService);
  readonly planning = inject(InventoryPlanningService);
  readonly ingredientPlanning = inject(InventoryIngredientPlanningService);
  readonly cannotModify = computed(() => this.disabled() || !this.inventory.ready() || this.inventory.loading() || !!this.inventory.error());
  readonly amountLabel = inventoryAmountLabel;
  readonly groupTotal = inventoryGroupTotal;
  readonly categoryLabel = ingredientCategoryLabel;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
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
        : this.document.getElementById('inventory-tab-' + this.inventory.selectedSpace());
      target?.focus({ preventScroll: true });
    });
  }

  close(event?: Event): void {
    event?.preventDefault();
    if (!this.disabled()) this.closed.emit();
  }

  recipeAvailable(): boolean {
    const id = this.group().item.recipeId;
    return !!id && this.inventory.availableRecipeIds().includes(id.toLowerCase());
  }

  withdraw(item: InventoryItem): void {
    if (this.cannotModify()) return;
    const previous = this.document.activeElement;
    const index = this.group().items.findIndex(lot => lot.id === item.id);
    this.withdrawRequested.emit(item);
    afterNextRender(() => {
      if (previous?.isConnected) return;
      const dialog = this.dialog().nativeElement;
      const buttons = dialog.querySelectorAll<HTMLButtonElement>('.withdraw-button');
      const target = buttons[Math.min(index, buttons.length - 1)] ?? dialog.querySelector<HTMLButtonElement>('.icon-button');
      target?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  dateLabel(date: string): string { return date.split('-').reverse().join('/'); }
}
