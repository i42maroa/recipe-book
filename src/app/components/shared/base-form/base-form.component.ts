import { AsyncPipe } from '@angular/common';
import { Component, DestroyRef, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, map, startWith } from 'rxjs';
import { ButtonComponent } from '../button/button.component';
import { FilterContainerComponent } from '../filters/filter-container/filter-container.component';
import { SelectFilterComponent } from '../filters/select-filter/select-filter.component';
import { CuisineType, Ingredient, IngredientCategory, MealType, Recipe, RecipeDifficulty, RecipeIngredientAmount } from '../../../models/recipe.model';
import { BaseFormType, RecipeFormValue } from '../../../models/form.model';
import { IngredientService } from '../../../services/ingredient.service';
import { NotificationService } from '../../../services/notification.service';
import { SelectFilterOption } from '../filters/select-filter-options';
import { IconComponent } from '../icon/icon.component';

interface IngredientGroup { category: IngredientCategory; ingredients: Ingredient[] }

@Component({
  selector: 'app-base-form', standalone: true, imports: [ReactiveFormsModule, AsyncPipe, ButtonComponent, FilterContainerComponent, SelectFilterComponent, IconComponent],
  templateUrl: './base-form.component.html',
  styleUrl: './base-form.component.css'
})
export class BaseFormComponent implements OnInit {
  @Input() formType: BaseFormType = 'recipe';
  @Input() recipeToEdit: Recipe | null = null;
  @Input() ingredientToEdit: Ingredient | null = null;
  @Output() cancel = new EventEmitter<void>();
  @Output() recipeSaved = new EventEmitter<RecipeFormValue>();
  activeRecipeTab = 0;
  readonly recipeTabLabels = ['Datos', 'Ingredientes', 'Preparación'];

  private readonly fb = inject(FormBuilder);
  private readonly ingredientService = inject(IngredientService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  readonly ingredients$ = this.ingredientService.ingredients$;
  readonly ingredientSearch = this.fb.nonNullable.control('');
  readonly ingredientCategoryFilter = this.fb.nonNullable.control<IngredientCategory | ''>('');
  readonly compositionSearch = this.fb.nonNullable.control('');
  readonly compositionCategoryFilter = this.fb.nonNullable.control<IngredientCategory | ''>('');
  readonly filteredIngredients$ = combineLatest([
    this.ingredients$,
    this.ingredientSearch.valueChanges.pipe(startWith('')),
    this.ingredientCategoryFilter.valueChanges.pipe(startWith('')),
  ]).pipe(
    map(([ingredients, query, category]) => {
      const normalizedQuery = this.normalizeSearch(query);
      const filtered = ingredients.filter((ingredient) =>
        (!normalizedQuery || this.normalizeSearch(ingredient.name).includes(normalizedQuery))
        && (!category || ingredient.category === category),
      );
      return this.groupIngredients(filtered);
    }),
  );
  readonly mealTypes: MealType[] = ['Desayuno', 'Entrante', 'Plato', 'Postre'];
  readonly cuisineTypes: CuisineType[] = ['Española', 'Italiana', 'Mexicana', 'Japonesa', 'China', 'India', 'Francesa', 'Peruana', 'Árabe', 'Otra'];
  readonly difficulties: RecipeDifficulty[] = ['F\u00e1cil', 'Media', 'Dif\u00edcil'];
  readonly categories: IngredientCategory[] = ['Verdura', 'Fruta', 'Legumbre', 'Pescado', 'Carne', 'Lacteo', 'Cereal', 'Especia', 'Elaboracion', 'Otro'];
  readonly quickCategories = this.categories.filter((category) => category !== 'Elaboracion');
  readonly ingredientCategoryOptions: SelectFilterOption[] = [
    { value: '', label: 'Todas las categorias' },
    ...this.categories.map((category) => ({ value: category, label: category })),
  ];
  readonly compositionCategoryOptions: SelectFilterOption[] = [
    { value: '', label: 'Todas las categorias' },
    ...this.quickCategories.map((category) => ({ value: category, label: category })),
  ];
  readonly compositionIngredients$ = this.ingredients$.pipe(
    map((ingredients) => ingredients.filter((ingredient) =>
      ingredient.category !== 'Elaboracion' && ingredient.id !== this.ingredientToEdit?.id,
    )),
  );
  readonly filteredCompositionIngredients$ = combineLatest([
    this.compositionIngredients$,
    this.compositionSearch.valueChanges.pipe(startWith('')),
    this.compositionCategoryFilter.valueChanges.pipe(startWith('')),
  ]).pipe(
    map(([ingredients, query, category]) => {
      const normalizedQuery = this.normalizeSearch(query);
      const filtered = ingredients.filter((ingredient) =>
        (!normalizedQuery || this.normalizeSearch(ingredient.name).includes(normalizedQuery))
        && (!category || ingredient.category === category),
      );
      return this.groupIngredients(filtered);
    }),
  );
  readonly recipeForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]], ingredientIds: this.fb.nonNullable.control<string[]>([]),
    ingredientAmounts: this.fb.nonNullable.control<Record<string, RecipeIngredientAmount>>({}), minutes: this.fb.control<number | null>(null),
    steps: [''], pending: ['yes', Validators.required], mealTypes: this.fb.nonNullable.control<MealType[]>([]), cuisineTypes: this.fb.nonNullable.control<CuisineType[]>([]),
    rating: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(10)]), sourceUrl: [''], annotations: [''], fitness: [false], difficulty: this.fb.nonNullable.control<RecipeDifficulty>('Media')
  });
  readonly selectedIngredients$ = combineLatest([
    this.ingredients$,
    this.recipeForm.controls.ingredientIds.valueChanges.pipe(startWith(this.recipeForm.controls.ingredientIds.value)),
  ]).pipe(
    map(([ingredients, selectedIds]) => this.groupIngredients(selectedIds
      .map((id) => ingredients.find((ingredient) => ingredient.id === id))
      .filter((ingredient): ingredient is Ingredient => ingredient !== undefined))),
  );
  readonly ingredientForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    category: ['' as IngredientCategory | '', Validators.required],
    derivedFromIds: this.fb.nonNullable.control<string[]>([]),
    derivedFromAmounts: this.fb.nonNullable.control<Record<string, RecipeIngredientAmount>>({}),
  });
  readonly selectedCompositionIngredients$ = combineLatest([
    this.ingredients$,
    this.ingredientForm.controls.derivedFromIds.valueChanges.pipe(startWith(this.ingredientForm.controls.derivedFromIds.value)),
  ]).pipe(
    map(([ingredients, selectedIds]) => this.groupIngredients(selectedIds
      .map((id) => ingredients.find((ingredient) => ingredient.id === id))
      .filter((ingredient): ingredient is Ingredient => ingredient !== undefined))),
  );
  readonly newIngredientName = this.fb.nonNullable.control('');
  readonly newIngredientCategory = this.fb.nonNullable.control<IngredientCategory | ''>('');

  constructor() {
    this.ingredients$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ingredients) => {
      const ids = this.recipeForm.controls.ingredientIds.value.filter((id) => ingredients.some((item) => item.id === id));
      this.recipeForm.controls.ingredientIds.setValue(ids, { emitEvent: false });
      const amounts = this.recipeForm.controls.ingredientAmounts.value;
      const validAmounts = Object.fromEntries(Object.entries(amounts).filter(([id]) => ids.includes(id)));
      this.recipeForm.controls.ingredientAmounts.setValue(validAmounts, { emitEvent: false });
      const componentIds = this.ingredientForm.controls.derivedFromIds.value.filter((id) => ingredients.some((item) => item.id === id));
      this.ingredientForm.controls.derivedFromIds.setValue(componentIds, { emitEvent: false });
      const componentAmounts = this.ingredientForm.controls.derivedFromAmounts.value;
      const validComponentAmounts = Object.fromEntries(Object.entries(componentAmounts).filter(([id]) => componentIds.includes(id)));
      this.ingredientForm.controls.derivedFromAmounts.setValue(validComponentAmounts, { emitEvent: false });
    });
  }

  ngOnInit(): void {
    this.activeRecipeTab = 0;
    if (this.recipeToEdit) {
      this.recipeForm.patchValue({
        ...this.recipeToEdit,
        ingredientAmounts: this.recipeToEdit.ingredientAmounts ?? {},
        steps: this.recipeToEdit.steps.join('\n'),
        pending: this.recipeToEdit.pending ? 'yes' : 'no',
        cuisineTypes: this.recipeToEdit.cuisineTypes ?? [],
        annotations: this.recipeToEdit.annotations ?? '',
        fitness: this.recipeToEdit.fitness ?? false,
      });
    }
    if (this.ingredientToEdit) {
      this.ingredientForm.patchValue({
        ...this.ingredientToEdit,
        derivedFromIds: this.ingredientToEdit.derivedFromIds ?? [],
        derivedFromAmounts: this.ingredientToEdit.derivedFromAmounts ?? {},
      });
    }
  }

  isSelected(id: string): boolean { return this.recipeForm.controls.ingredientIds.value.includes(id); }
  isCompositionSelected(id: string): boolean {
    return this.ingredientForm.controls.derivedFromIds.value.includes(id);
  }
  toggleCompositionIngredient(id: string): void {
    const selected = this.ingredientForm.controls.derivedFromIds.value;
    const wasSelected = selected.includes(id);
    this.ingredientForm.controls.derivedFromIds.setValue(wasSelected ? selected.filter((value) => value !== id) : [...selected, id]);
    if (wasSelected) this.setCompositionAmount(id, null);
  }
  compositionAmountKind(id: string): 'none' | RecipeIngredientAmount['kind'] {
    return this.ingredientForm.controls.derivedFromAmounts.value[id]?.kind ?? 'none';
  }
  compositionAmount(id: string): RecipeIngredientAmount | null {
    return this.ingredientForm.controls.derivedFromAmounts.value[id] ?? null;
  }
  setCompositionAmountKind(id: string, kind: string): void {
    if (kind === 'none') { this.setCompositionAmount(id, null); return; }
    if (kind === 'spoon' || kind === 'glass') { this.setCompositionAmount(id, { kind }); return; }
    const current = this.compositionAmount(id);
    this.setCompositionAmount(id, current?.kind === 'specific' ? current : { kind: 'specific', value: null, unit: 'g' });
  }
  setCompositionAmountValue(id: string, rawValue: string): void {
    const amount = this.compositionAmount(id);
    if (amount?.kind !== 'specific') return;
    const value = rawValue === '' ? null : Number(rawValue);
    this.setCompositionAmount(id, { ...amount, value: value !== null && Number.isFinite(value) ? value : null });
  }
  setCompositionAmountUnit(id: string, unit: string): void {
    const amount = this.compositionAmount(id);
    if (amount?.kind !== 'specific' || (unit !== 'ml' && unit !== 'g' && unit !== 'pieza')) return;
    this.setCompositionAmount(id, { ...amount, unit });
  }
  private setCompositionAmount(id: string, amount: RecipeIngredientAmount | null): void {
    const amounts = { ...this.ingredientForm.controls.derivedFromAmounts.value };
    if (amount) amounts[id] = amount;
    else delete amounts[id];
    this.ingredientForm.controls.derivedFromAmounts.setValue(amounts);
  }
  private normalizeSearch(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  }
  private groupIngredients(ingredients: Ingredient[]): IngredientGroup[] {
    return this.categories
      .map((category) => ({ category, ingredients: ingredients.filter((ingredient) => ingredient.category === category) }))
      .filter((group) => group.ingredients.length > 0);
  }
  hasMealType(type: MealType): boolean { return this.recipeForm.controls.mealTypes.value.includes(type); }
  hasCuisineType(type: CuisineType): boolean { return this.recipeForm.controls.cuisineTypes.value.includes(type); }
  toggleCuisineType(type: CuisineType): void {
    const selected = this.recipeForm.controls.cuisineTypes.value;
    this.recipeForm.controls.cuisineTypes.setValue(selected.includes(type) ? selected.filter((value) => value !== type) : [...selected, type]);
  }
  toggleIngredient(id: string): void {
    const selected = this.recipeForm.controls.ingredientIds.value;
    const wasSelected = selected.includes(id);
    this.recipeForm.controls.ingredientIds.setValue(wasSelected ? selected.filter((value) => value !== id) : [...selected, id]);
    if (wasSelected) this.setIngredientAmount(id, null);
    this.recipeForm.controls.ingredientIds.markAsTouched();
  }
  ingredientAmountKind(id: string): 'none' | RecipeIngredientAmount['kind'] {
    return this.recipeForm.controls.ingredientAmounts.value[id]?.kind ?? 'none';
  }
  ingredientAmount(id: string): RecipeIngredientAmount | null {
    return this.recipeForm.controls.ingredientAmounts.value[id] ?? null;
  }
  setIngredientAmountKind(id: string, kind: string): void {
    if (kind === 'none') {
      this.setIngredientAmount(id, null);
      return;
    }
    if (kind === 'spoon' || kind === 'glass') {
      this.setIngredientAmount(id, { kind });
      return;
    }
    const current = this.ingredientAmount(id);
    this.setIngredientAmount(id, current?.kind === 'specific' ? current : { kind: 'specific', value: null, unit: 'g' });
  }
  setSpecificAmountValue(id: string, rawValue: string): void {
    const amount = this.ingredientAmount(id);
    if (amount?.kind !== 'specific') return;
    const value = rawValue === '' ? null : Number(rawValue);
    this.setIngredientAmount(id, { ...amount, value: value !== null && Number.isFinite(value) ? value : null });
  }
  setSpecificAmountUnit(id: string, unit: string): void {
    const amount = this.ingredientAmount(id);
    if (amount?.kind !== 'specific' || (unit !== 'ml' && unit !== 'g' && unit !== 'pieza')) return;
    this.setIngredientAmount(id, { ...amount, unit });
  }
  setRecipeTab(tab: number): void {
    if (tab < 0 || tab >= this.recipeTabLabels.length || tab === this.activeRecipeTab) return;
    if (tab > this.activeRecipeTab && !this.validateRecipeDetails()) return;
    if (tab > 1 && !this.validateRecipeIngredients()) return;
    this.activeRecipeTab = tab;
  }
  previousRecipeTab(): void {
    this.activeRecipeTab = Math.max(0, this.activeRecipeTab - 1);
  }
  nextRecipeTab(): void {
    this.setRecipeTab(this.activeRecipeTab + 1);
  }
  private validateRecipeDetails(): boolean {
    const name = this.recipeForm.controls.name;
    const pending = this.recipeForm.controls.pending;
    name.markAsTouched();
    pending.markAsTouched();
    return name.valid && pending.valid;
  }
  private validateRecipeIngredients(): boolean {
    const ids = this.recipeForm.controls.ingredientIds;
    ids.markAsTouched();
    if (ids.value.length === 0) return false;
    const hasIncompleteAmount = ids.value.some((id) => {
      const amount = this.recipeForm.controls.ingredientAmounts.value[id];
      return amount?.kind === 'specific' && (amount.value === null || amount.value <= 0);
    });
    if (hasIncompleteAmount) {
      this.notifications.error('Indica una cantidad mayor que cero o elige otra opción.');
      return false;
    }
    return true;
  }
  private setIngredientAmount(id: string, amount: RecipeIngredientAmount | null): void {
    const amounts = { ...this.recipeForm.controls.ingredientAmounts.value };
    if (amount) amounts[id] = amount;
    else delete amounts[id];
    this.recipeForm.controls.ingredientAmounts.setValue(amounts);
  }
  toggleMealType(type: MealType): void {
    const selected = this.recipeForm.controls.mealTypes.value;
    this.recipeForm.controls.mealTypes.setValue(selected.includes(type) ? selected.filter((value) => value !== type) : [...selected, type]);
  }
  async addQuickIngredient(): Promise<void> {
    const name = this.newIngredientName.value.trim();
    const category = this.newIngredientCategory.value;
    if (!name || !category) { this.notifications.error('Escribe el nombre y elige una categoría.'); return; }
    let ingredient: Ingredient;
    try { ingredient = await this.ingredientService.add(name, category); }
    catch (error) { this.notifications.error(error instanceof Error ? error.message : 'No se pudo guardar el ingrediente.'); return; }
    this.toggleIngredient(ingredient.id);
    this.newIngredientName.setValue('');
    this.newIngredientCategory.setValue('');
    this.notifications.success(`${name} añadido a tus ingredientes.`);
  }
  saveRecipe(): void {
    if (this.activeRecipeTab !== this.recipeTabLabels.length - 1) return;
    this.recipeForm.controls.ingredientIds.markAsTouched();
    if (this.recipeForm.invalid || this.recipeForm.controls.ingredientIds.value.length === 0) return;
    const value = this.recipeForm.getRawValue();
    if (value.rating !== null && (!Number.isInteger(value.rating) || value.rating < 1 || value.rating > 10)) { this.notifications.error('La valoración debe ser un número entero del 1 al 10.'); return; }
    if (value.minutes !== null && value.minutes < 1) { this.notifications.error('El tiempo debe ser mayor que cero minutos.'); return; }
    const hasIncompleteAmount = value.ingredientIds.some((id) => {
      const amount = value.ingredientAmounts[id];
      return amount?.kind === 'specific' && (amount.value === null || amount.value <= 0);
    });
    if (hasIncompleteAmount) { this.notifications.error('Indica una cantidad mayor que cero o elige otra opción.'); return; }
    this.recipeSaved.emit({ ...value, steps: value.steps.split('\n').map((step) => step.trim()).filter(Boolean) });
  }
  async saveIngredient(): Promise<void> {
    if (this.ingredientForm.invalid) return;
    const value = this.ingredientForm.getRawValue();
    const derivedFromIds = value.category === 'Elaboracion' ? value.derivedFromIds : [];
    const derivedFromAmounts = value.category === 'Elaboracion' ? value.derivedFromAmounts : {};
    if (value.category === 'Elaboracion' && derivedFromIds.length === 0) {
      this.notifications.error('Selecciona al menos un ingrediente para esta elaboraci\u00f3n.');
      return;
    }
    const hasIncompleteAmount = derivedFromIds.some((id) => {
      const amount = derivedFromAmounts[id];
      return amount?.kind === 'specific' && (amount.value === null || amount.value <= 0);
    });
    if (hasIncompleteAmount) {
      this.notifications.error('Indica una cantidad mayor que cero o elige otra opci\u00f3n.');
      return;
    }
    if (this.ingredientToEdit) {
      try { await this.ingredientService.update(this.ingredientToEdit.id, {
        name: value.name,
        category: value.category as IngredientCategory,
        derivedFromIds,
        derivedFromAmounts,
      }); } catch (error) { this.notifications.error(error instanceof Error ? error.message : 'No se pudo actualizar el ingrediente.'); return; }
      this.notifications.success(`${value.name} actualizado.`);
      this.cancel.emit();
      return;
    }
    try { await this.ingredientService.add(value.name, value.category as IngredientCategory, derivedFromIds, derivedFromAmounts); }
    catch (error) { this.notifications.error(error instanceof Error ? error.message : 'No se pudo guardar el ingrediente.'); return; }
    this.notifications.success(`${value.name} añadido a tus ingredientes.`);
    this.cancel.emit();
  }
}




