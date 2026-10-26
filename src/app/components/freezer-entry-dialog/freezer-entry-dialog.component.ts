import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FreezerItem } from '../../models/freezer.model';
import { RecipeIngredientAmount } from '../../models/recipe.model';
import { IngredientService } from '../../services/ingredient.service';
import { freezerFingerprint, validFreezerAmount, validFreezers } from '../../utils/freezer.utils';
import { localDate } from '../../utils/scheduled-meal.utils';
import { ingredientCategoryLabel } from '../../utils/recipe-display.utils';
import { IngredientFilterComponent } from '../shared/filters/ingredient-filter/ingredient-filter.component';
import { IconComponent } from '../shared/icon/icon.component';

function entryForm(item: FreezerItem) {
  return new FormGroup({
    name: new FormControl(item.name, { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/)] }),
    enteredOn: new FormControl(item.enteredOn, { nonNullable: true, validators: [Validators.required] }),
    kind: new FormControl<'none' | RecipeIngredientAmount['kind']>(item.amount?.kind ?? 'none', { nonNullable: true }),
    value: new FormControl<number | null>(item.amount?.kind === 'specific' ? item.amount.value : null),
    unit: new FormControl<'g' | 'ml' | 'pieza'>(item.amount?.kind === 'specific' ? item.amount.unit : 'g', { nonNullable: true }),
  }, { validators: control => {
    const { kind, value, unit } = control.getRawValue();
    return kind !== 'specific' || validFreezerAmount({ kind, value, unit }) ? null : { amount: true };
  } });
}
interface EntryRow { item: FreezerItem; form: ReturnType<typeof entryForm> }

@Component({
  selector: 'app-freezer-entry-dialog', standalone: true,
  imports: [ReactiveFormsModule, IngredientFilterComponent, IconComponent],
  templateUrl: './freezer-entry-dialog.component.html',
  styleUrl: './freezer-entry-dialog.component.css',
})
export class FreezerEntryDialogComponent {
  readonly freezerName = input.required<string>();
  readonly initialItem = input<FreezerItem | null>(null);
  readonly confirmed = output<FreezerItem[]>();
  readonly closed = output<void>();
  private readonly ingredients = inject(IngredientService);
  private readonly document = inject(DOCUMENT);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly picker = viewChild(IngredientFilterComponent);
  readonly creating = computed(() => this.picker()?.addingIngredient() ?? false);
  readonly mode = signal<'ingredient' | 'product'>('ingredient');
  readonly rows = signal<EntryRow[]>([]);
  readonly selectedIds = computed(() => this.rows().flatMap(row => row.item.ingredientId ? [row.item.ingredientId] : []));
  readonly productName = new FormControl('', { nonNullable: true });
  readonly error = signal('');
  readonly categoryLabel = ingredientCategoryLabel;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const previousFocus = this.document.activeElement as HTMLElement | null;
    const previousOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
    afterNextRender(() => {
      const item = this.initialItem();
      if (item) this.rows.set([{ item: structuredClone(item), form: entryForm(item) }]);
      this.dialog().nativeElement.showModal();
    });
    destroyRef.onDestroy(() => {
      this.dialog().nativeElement.close();
      this.document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    });
  }

  addIngredients(ids: string[]): void {
    if (this.initialItem()) return;
    const selected = new Set(this.selectedIds());
    for (const id of ids) {
      if (selected.has(id)) continue;
      const ingredient = this.ingredients.getById(id);
      if (!ingredient) continue;
      this.addRow({ id: crypto.randomUUID(), ingredientId: ingredient.id, name: ingredient.name,
        category: ingredient.category, amount: null, enteredOn: localDate() });
    }
  }

  addProduct(): void {
    const name = this.productName.value.trim();
    if (!name || this.creating() || this.initialItem()) return;
    this.addRow({ id: crypto.randomUUID(), ingredientId: null, name, category: null, amount: null, enteredOn: localDate() });
    this.productName.setValue('');
  }

  private addRow(item: FreezerItem): void {
    this.rows.update(rows => [...rows, { item, form: entryForm(item) }]); this.error.set('');
  }

  remove(id: string): void {
    if (this.creating()) return;
    this.rows.update(rows => rows.filter(row => row.item.id !== id)); this.error.set('');
  }

  private entries(): FreezerItem[] {
    return this.rows().map(row => {
      const value = row.form.getRawValue();
      const amount: RecipeIngredientAmount | null = value.kind === 'none' ? null : value.kind === 'specific'
        ? { kind: 'specific', value: value.value, unit: value.unit } : { kind: value.kind };
      return { ...row.item, name: value.name.trim(), enteredOn: value.enteredOn, amount };
    });
  }

  hasChanges(): boolean {
    const fingerprint = (items: FreezerItem[]): string => freezerFingerprint([{ id: '00000000-0000-4000-8000-000000000000', name: '', items }]);
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
    if (this.creating()) return;
    if (this.mode() === 'product' && this.productName.value.trim()) {
      this.error.set('Pulsa «Añadir» para incluir el producto escrito, o borra su nombre.'); return;
    }
    const items = this.entries();
    this.rows().forEach(row => row.form.markAllAsTouched());
    if (!items.length || this.rows().some(row => row.form.invalid)
      || !validFreezers([{ id: '00000000-0000-4000-8000-000000000000', name: this.freezerName(), items }])) {
      this.error.set('Añade al menos un elemento y revisa sus datos: nombre, fecha y cantidad positiva cuando la especifiques.'); return;
    }
    this.confirmed.emit(items);
  }
}
