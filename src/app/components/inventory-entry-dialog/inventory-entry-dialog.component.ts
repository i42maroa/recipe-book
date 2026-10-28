import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { InventoryItem, InventorySpace } from '../../models/inventory.model';
import { RecipeCard } from '../../models/recipe-card.model';
import { Ingredient, RecipeIngredientAmount } from '../../models/recipe.model';
import { allowedIngredientAmount, validIngredientAmount } from '../../utils/ingredient-measures.utils';
import { IngredientAmountComponent } from '../shared/ingredient-amount/ingredient-amount.component';
import { IngredientService } from '../../services/ingredient.service';
import { inventoryFingerprint, validInventory } from '../../utils/inventory.utils';
import { lockDialogScroll } from '../../utils/dialog-scroll.utils';
import { PlannerStateService } from '../../services/planner-state.service';
import { localDate } from '../../utils/scheduled-meal.utils';
import { ingredientCategoryLabel } from '../../utils/recipe-display.utils';
import { IngredientFilterComponent } from '../shared/filters/ingredient-filter/ingredient-filter.component';
import { IconComponent } from '../shared/icon/icon.component';
import { RecipePickerComponent } from '../recipe-picker/recipe-picker.component';

function entryForm(item: InventoryItem) {
  return new FormGroup({
    name: new FormControl(item.name, { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/)] }),
    enteredOn: new FormControl(item.enteredOn, { nonNullable: true, validators: [Validators.required] }),
    servings: new FormControl<number | null>(item.servings),
    amount: new FormControl<RecipeIngredientAmount | null>(item.amount),
  }, { validators: control => {
    const { amount, servings } = control.getRawValue();
    if (item.recipeId) return Number.isInteger(servings) && servings! > 0 && servings! <= 2147483647 ? null : { servings: true };
    return validIngredientAmount(amount) ? null : { amount: true };
  } });
}
interface EntryRow { item: InventoryItem; form: ReturnType<typeof entryForm> }

@Component({
  selector: 'app-inventory-entry-dialog', standalone: true,
  imports: [ReactiveFormsModule, IngredientFilterComponent, IconComponent, RecipePickerComponent, IngredientAmountComponent],
  providers: [PlannerStateService],
  templateUrl: './inventory-entry-dialog.component.html',
  styleUrl: './inventory-entry-dialog.component.css',
})
export class InventoryEntryDialogComponent {
  readonly placeName = input.required<string>();
  readonly space = input.required<InventorySpace>();
  readonly initialItem = input<InventoryItem | null>(null);
  readonly returnFocus = input<HTMLElement | null>(null);
  readonly confirmed = output<InventoryItem[]>();
  readonly closed = output<void>();
  private readonly ingredients = inject(IngredientService);
  private readonly recipeState = inject(PlannerStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly picker = viewChild(IngredientFilterComponent);
  readonly creating = computed(() => this.picker()?.addingIngredient() ?? false);
  readonly mode = signal<'ingredient' | 'recipe' | 'product'>('ingredient');
  readonly selectedRecipeIds = computed(() => this.rows().flatMap(row => row.item.recipeId ? [row.item.recipeId] : []));
  readonly rows = signal<EntryRow[]>([]);
  readonly selectedIds = computed(() => this.rows().flatMap(row => row.item.ingredientId ? [row.item.ingredientId] : []));
  readonly productName = new FormControl('', { nonNullable: true });
  readonly error = signal('');
  readonly loadingMeasures = signal(false);
  readonly measuresError = signal(false);
  readonly categoryLabel = ingredientCategoryLabel;

  constructor() {
    this.recipeState.pickerFilters = { ...this.recipeState.pickerFilters, pending: 'done' };
    const previousFocus = this.document.activeElement as HTMLElement | null;
    const releaseScroll = lockDialogScroll(this.document);
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      void this.loadInitial();
    });
    this.destroyRef.onDestroy(() => {
      this.dialog().nativeElement.close();
      releaseScroll();
      const target = this.returnFocus() ?? previousFocus;
      if (target?.isConnected && !target.matches(':disabled')) target.focus({ preventScroll: true });
    });
  }

  async loadInitial(force = false): Promise<void> {
    const item = this.initialItem();
    if (!item || this.loadingMeasures()) return;
    this.loadingMeasures.set(true); this.measuresError.set(false);
    try {
      if (item.ingredientId) await (force ? this.ingredients.refresh() : this.ingredients.ensureLoaded());
      if (!this.destroyRef.destroyed) this.rows.set([{ item: structuredClone(item), form: entryForm(item) }]);
    } catch { if (!this.destroyRef.destroyed) this.measuresError.set(true); }
    finally { if (!this.destroyRef.destroyed) this.loadingMeasures.set(false); }
  }

  ingredientFor(item: InventoryItem): Ingredient | undefined {
    if (!item.ingredientId) return undefined;
    return this.ingredients.getById(item.ingredientId) ?? { id: item.ingredientId, name: item.name, category: item.category!,
      baseUnit: item.amount?.kind === 'specific' && item.amount.unit !== 'pieza' ? item.amount.unit : item.amount?.kind === 'specific' ? item.amount.baseUnit : undefined,
      unitQuantity: item.amount?.kind === 'specific' ? item.amount.unitQuantity ?? null : null };
  }

  addIngredients(ids: string[]): void {
    if (this.initialItem()) return;
    const selected = new Set(this.selectedIds());
    for (const id of ids) {
      if (selected.has(id)) continue;
      const ingredient = this.ingredients.getById(id);
      if (!ingredient) continue;
      this.addRow({ id: crypto.randomUUID(), ingredientId: ingredient.id, name: ingredient.name,
        category: ingredient.category, amount: null, enteredOn: localDate(), arrivedOn: localDate(),
        space: this.space(), recipeId: null, servings: null });
      selected.add(id);
    }
  }

  addProduct(): void {
    const name = this.productName.value.trim();
    if (!name || this.creating() || this.initialItem()) return;
    this.addRow({ id: crypto.randomUUID(), ingredientId: null, name, category: null, amount: null, enteredOn: localDate(),
      arrivedOn: localDate(), space: this.space(), recipeId: null, servings: null });
    this.productName.setValue('');
  }

  addRecipe(recipe: RecipeCard): void {
    if (this.initialItem() || this.creating()) return;
    if (!this.selectedRecipeIds().some(id => id.toLowerCase() === recipe.id.toLowerCase())) {
      this.addRow({ id: crypto.randomUUID(), ingredientId: null, recipeId: recipe.id, name: recipe.name,
        category: null, amount: null, servings: 1, enteredOn: localDate(), arrivedOn: localDate(), space: this.space() });
    }
  }

  private addRow(item: InventoryItem): void {
    this.rows.update(rows => [...rows, { item, form: entryForm(item) }]); this.error.set('');
  }

  remove(id: string): void {
    if (this.creating()) return;
    this.rows.update(rows => rows.filter(row => row.item.id !== id)); this.error.set('');
  }

  private entries(): InventoryItem[] {
    return this.rows().map(row => {
      const value = row.form.getRawValue();
      return { ...row.item, name: value.name.trim(), enteredOn: value.enteredOn,
        arrivedOn: row.item.arrivedOn === row.item.enteredOn ? value.enteredOn : row.item.arrivedOn,
        amount: row.item.recipeId ? null : value.amount, servings: row.item.recipeId ? value.servings : null };
    });
  }

  hasChanges(): boolean {
    const fingerprint = (items: InventoryItem[]): string => inventoryFingerprint([{ id: '00000000-0000-4000-8000-000000000000', name: '', items }]);
    return !!this.productName.value.trim() || (this.initialItem()
      ? fingerprint(this.entries()) !== fingerprint([this.initialItem()!]) : this.rows().length > 0);
  }

  close(event?: Event): void {
    event?.preventDefault();
    if (this.creating()) return;
    if (this.hasChanges() && !window.confirm('¿Quieres cerrar y descartar los cambios de este formulario?')) return;
    this.closed.emit();
  }

  submit(event: Event): void {
    event.preventDefault();
    if (this.creating() || this.loadingMeasures() || this.measuresError()) return;
    if (this.mode() === 'product' && this.productName.value.trim()) {
      this.error.set('Pulsa «Añadir» para incluir el producto escrito, o borra su nombre.'); return;
    }
    const items = this.entries();
    this.rows().forEach(row => row.form.markAllAsTouched());
    if (!items.length || this.rows().some(row => row.form.invalid || (!row.item.recipeId && !allowedIngredientAmount(row.form.controls.amount.value, this.ingredientFor(row.item), this.initialItem()?.amount)))
      || !validInventory([{ id: '00000000-0000-4000-8000-000000000000', name: this.placeName(), items }])) {
      this.error.set('Añade al menos un elemento y revisa sus datos: nombre, fecha y cantidad positiva cuando la especifiques.'); return;
    }
    this.confirmed.emit(items);
  }
}
