import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShoppingItem } from '../../models/shopping-list.model';
import { ScheduledMealService } from '../../services/scheduled-meal.service';
import { ShoppingListService } from '../../services/shopping-list.service';
import { calendarPeriodLabel, calendarWeek, localDate, shiftDate } from '../../utils/scheduled-meal.utils';
import { shoppingGroups } from '../../utils/shopping-list.utils';
import { IconComponent } from '../shared/icon/icon.component';
import { SkeletonComponent } from '../shared/skeleton/skeleton.component';
import { IngredientService } from '../../services/ingredient.service';
import { InventoryService } from '../../services/inventory.service';
import { shoppingQuantityLabel, subtractShoppingStock } from '../../utils/shopping-quantities.utils';

@Component({
  selector: 'app-shopping-plan-picker', standalone: true,
  imports: [RouterLink, IconComponent, SkeletonComponent],
  templateUrl: './shopping-plan-picker.component.html',
  styleUrl: './shopping-plan-picker.component.css',
})
export class ShoppingPlanPickerComponent {
  readonly selected = output<ShoppingItem[]>();
  readonly disabled = input(false);
  private readonly destroyRef = inject(DestroyRef);
  private readonly meals = inject(ScheduledMealService);
  private readonly shopping = inject(ShoppingListService);
  private readonly inventory = inject(InventoryService);
  private readonly ingredients = inject(IngredientService);
  readonly inventoryChoice = signal<boolean | null>(null);
  readonly quantityLabel = shoppingQuantityLabel;
  readonly excludedAll = signal(false);
  readonly today = localDate();
  readonly start = signal(this.today);
  readonly from = signal('');
  readonly to = signal('');
  readonly rangeSelected = computed(() => !!this.from() && !!this.to());
  readonly choosingEnd = signal(false);
  readonly days = computed(() => calendarWeek(this.start()));
  readonly periodLabel = computed(() => calendarPeriodLabel(this.start(), shiftDate(this.start(), 6)));
  readonly fromLabel = computed(() => this.from() ? `${calendarWeek(this.from())[0].label} ${this.from().slice(0, 4)}` : 'Elige un día');
  readonly toLabel = computed(() => this.to() ? `${calendarWeek(this.to())[0].label} ${this.to().slice(0, 4)}` : 'Elige un día');
  readonly counts = signal<Record<string, number>>({});
  readonly loadingWeek = signal(false);
  readonly weekError = signal(false);
  readonly preview = signal<ShoppingItem[]>([]);
  readonly groups = computed(() => shoppingGroups(this.preview()));
  readonly loadingPreview = signal(false);
  readonly previewError = signal('');
  readonly previewReady = computed(() => this.rangeSelected() && this.inventoryChoice() !== null && !this.loadingPreview() && !this.previewError() && this.preview().length > 0);
  private weekRequest: AbortController | undefined;
  private previewRequest: AbortController | undefined;
  private weekRevision = 0;
  private previewRevision = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.weekRevision++; this.previewRevision++;
      this.weekRequest?.abort(); this.previewRequest?.abort();
    });
    void this.loadWeek();
  }

  moveWeek(direction: number): void {
    if (this.disabled()) return;
    const next = shiftDate(this.start(), direction * 7);
    if (next < this.today) return;
    this.start.set(next);
    void this.loadWeek();
  }

  choose(date: string): void {
    if (this.disabled() || date < this.today) return;
    const previousFrom = this.from(); const previousTo = this.to();
    if (!this.choosingEnd() || !this.from()) {
      this.from.set(date);
      if (this.to() && date > this.to()) this.to.set('');
      this.choosingEnd.set(true);
    } else {
      if (date < this.from()) this.from.set(date);
      this.to.set(date);
    }
    if (this.from() !== previousFrom || this.to() !== previousTo || this.previewError()) { this.inventoryChoice.set(null); void this.loadPreview(); }
  }

  async loadWeek(): Promise<void> {
    const revision = ++this.weekRevision;
    this.weekRequest?.abort(); const request = this.weekRequest = new AbortController();
    this.loadingWeek.set(true); this.weekError.set(false);
    try {
      const meals = await this.meals.getWeek(this.start(), request.signal);
      if (this.destroyRef.destroyed || revision !== this.weekRevision) return;
      const counts: Record<string, number> = {};
      for (const meal of meals) counts[meal.date] = (counts[meal.date] ?? 0) + meal.recipes.length;
      this.counts.set(counts);
    } catch { if (!this.destroyRef.destroyed && revision === this.weekRevision) this.weekError.set(true); }
    finally { if (!this.destroyRef.destroyed && revision === this.weekRevision) this.loadingWeek.set(false); }
  }

  async loadPreview(): Promise<void> {
    const revision = ++this.previewRevision;
    this.previewRequest?.abort(); this.previewRequest = undefined;
    this.previewError.set(''); this.preview.set([]);
    this.excludedAll.set(false);
    if (!this.rangeSelected() || this.inventoryChoice() === null) { this.loadingPreview.set(false); return; }
    const request = this.previewRequest = new AbortController();
    this.loadingPreview.set(true);
    try {
      const items = await this.shopping.fromPlanning(this.from(), this.to(), request.signal);
      let result = items;
      if (this.inventoryChoice()) {
        if (this.inventory.dirty() || this.inventory.saving()) throw new Error('Revisa los cambios pendientes del inventario antes de calcular lo que falta.');
        await Promise.all([this.inventory.load(true), this.ingredients.ensureLoaded()]);
        if (this.inventory.error() || !this.inventory.ready()) throw new Error(this.inventory.error() || 'No se pudo consultar el inventario.');
        const catalog = items.flatMap(item => { const ingredient = this.ingredients.getById(item.id); return ingredient ? [ingredient] : []; });
        result = subtractShoppingStock(items, this.inventory.places(), catalog);
      }
      if (!this.destroyRef.destroyed && revision === this.previewRevision && !request.signal.aborted) { this.preview.set(result); this.excludedAll.set(items.length > 0 && !result.length); }
    } catch (error) {
      if (!this.destroyRef.destroyed && revision === this.previewRevision) this.previewError.set(error instanceof Error ? error.message : 'No se pudieron calcular los ingredientes.');
    } finally { if (!this.destroyRef.destroyed && revision === this.previewRevision) this.loadingPreview.set(false); }
  }

  chooseInventory(value: boolean): void { if (!this.disabled()) { this.inventoryChoice.set(value); void this.loadPreview(); } }

  confirm(): void {
    if (!this.disabled() && this.previewReady()) this.selected.emit(this.preview());
  }
}
