import { cuisineFlag, ingredientCategoryLabel } from '../../../utils/recipe-display.utils';
import { AsyncPipe } from '@angular/common';
import { Component, DestroyRef, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { IngredientMeasuresComponent } from '../ingredient-measures/ingredient-measures.component';
import { IngredientAmountComponent } from '../ingredient-amount/ingredient-amount.component';
import { ingredientMeasuresForm, measuresFormValue } from '../../../utils/ingredient-measures-form.utils';
import { allowedIngredientAmount, ingredientBaseUnit, positiveQuantity } from '../../../utils/ingredient-measures.utils';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, combineLatest, defer, firstValueFrom, map, startWith } from 'rxjs';
import { ButtonComponent } from '../button/button.component';
import { FilterContainerComponent } from '../filters/filter-container/filter-container.component';
import { SelectFilterComponent } from '../filters/select-filter/select-filter.component';
import { INGREDIENT_CATEGORIES, CuisineType, Ingredient, IngredientCategory, MealType, Recipe, RecipeDifficulty, RecipeIngredientAmount, RecipePhoto } from '../../../models/recipe.model';
import { BaseFormType, RecipeFormValue } from '../../../models/form.model';
import { IngredientService } from '../../../services/ingredient.service';
import { NotificationService } from '../../../services/notification.service';
import { SelectFilterOption } from '../filters/select-filter-options';
import { RECIPE_DIFFICULTIES, RECIPE_MEAL_TYPES } from '../filters/recipe-filter-options';
import { IconComponent } from '../icon/icon.component';
import { MIN_SEARCH_LENGTH, normalizeSearch, searchTerms } from '../../../utils/search.utils';
import { findIngredients } from '../../../utils/ingredient-search.utils';
import { groupIngredients, selectedIngredients } from '../../../utils/ingredients.utils';

interface IngredientGroup { category: IngredientCategory; ingredients: Ingredient[] }

@Component({
  selector: 'app-base-form', standalone: true, imports: [ReactiveFormsModule, AsyncPipe, ButtonComponent, FilterContainerComponent, SelectFilterComponent, IconComponent, IngredientMeasuresComponent, IngredientAmountComponent],
  templateUrl: './base-form.component.html',
  styleUrl: './base-form.component.css'
})
export class BaseFormComponent implements OnInit {
  @Input() formType: BaseFormType = 'recipe';
  @Input() savingRecipe = false;
  readonly savingIngredient = signal(false);
  @Input() recipeToEdit: Recipe | null = null;
  @Input() ingredientToEdit: Ingredient | null = null;
  @Output() cancel = new EventEmitter<void>();
  @Output() recipeSaved = new EventEmitter<RecipeFormValue>();
  activeRecipeTab = 0;
  readonly recipeTabLabels = ['Datos', 'Ingredientes', 'Preparación', 'Fotos'];
  retainedRecipePhotos: RecipePhoto[] = [];
  readonly newRecipePhotos: { file: File; previewUrl: string }[] = [];
  photoDropActive = false;

  private readonly fb = inject(FormBuilder);
  readonly ingredientService = inject(IngredientService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  readonly ingredients$ = this.ingredientService.ingredients$;
  readonly minSearchLength = MIN_SEARCH_LENGTH;
  private readonly selectedIngredientIdsSubject = new BehaviorSubject<string[]>([]);
  readonly ingredientSearch = this.fb.nonNullable.control('');
  readonly ingredientCategoryFilter = this.fb.nonNullable.control<IngredientCategory | ''>('');
  readonly newIngredientName = this.fb.nonNullable.control('', [Validators.required, Validators.pattern(/\S/)]);
  readonly newIngredientCategory = this.fb.nonNullable.control<IngredientCategory | ''>('', Validators.required);
  readonly newIngredientMeasures = ingredientMeasuresForm();
  readonly newCompositionMeasures = ingredientMeasuresForm();
  private readonly recipeAmountControls = new Map<string, FormControl<RecipeIngredientAmount | null>>();
  private readonly compositionAmountControls = new Map<string, FormControl<RecipeIngredientAmount | null>>();
  readonly addingIngredient = signal(false);
  readonly ingredientDetailsReady = signal(true);
  readonly compositionSearch = this.fb.nonNullable.control('');
  readonly compositionCategoryFilter = this.fb.nonNullable.control<IngredientCategory | ''>('');
  readonly newCompositionName = this.fb.nonNullable.control('', [Validators.required, Validators.pattern(/\S/)]);
  readonly newCompositionCategory = this.fb.nonNullable.control<IngredientCategory | ''>('', Validators.required);
  readonly filteredIngredients$ = combineLatest([
    this.ingredientService.ingredientIndex$,
    defer(() => this.ingredientSearch.valueChanges.pipe(
      startWith(this.ingredientSearch.value),
      map((query) => query.trim().length >= MIN_SEARCH_LENGTH ? query : ''),
      searchTerms(),
    )),
    defer(() => this.ingredientCategoryFilter.valueChanges.pipe(startWith(this.ingredientCategoryFilter.value))),
    this.selectedIngredientIdsSubject,
  ]).pipe(
    map(([index, query, category, selectedIds]) => {
      const normalizedQuery = normalizeSearch(query);
      if (normalizedQuery.length < MIN_SEARCH_LENGTH && !category) return [];
      const filtered = findIngredients(index, query, { category, excludedIds: new Set(selectedIds) });
      return this.groupIngredients(filtered);
    }),
  );
  readonly mealTypes = RECIPE_MEAL_TYPES;
  readonly ratingOptions = Array.from({ length: 10 }, (_, index) => index + 1);
  readonly cuisineTypes: CuisineType[] = ['Española', 'Italiana', 'Mexicana', 'Japonesa', 'China', 'India', 'Francesa', 'Peruana', 'Árabe', 'Otra'];
  cuisineFlag(cuisine: CuisineType): string { return cuisineFlag(cuisine); }
  readonly difficulties = RECIPE_DIFFICULTIES;
  readonly categories: IngredientCategory[] = [...INGREDIENT_CATEGORIES];
  readonly quickCategories = this.categories.filter((category) => category !== 'Elaboracion');
  readonly ingredientCategoryOptions: SelectFilterOption[] = [
    { value: '', label: 'Todas las categorías' },
    ...this.categories.map((category) => ({ value: category, label: this.categoryLabel(category) })),
  ];
  readonly compositionCategoryOptions: SelectFilterOption[] = [
    { value: '', label: 'Todas las categorías' },
    ...this.quickCategories.map((category) => ({ value: category, label: this.categoryLabel(category) })),
  ];
  readonly newIngredientCategoryOptions: SelectFilterOption[] = this.quickCategories
    .map((category) => ({ value: category, label: this.categoryLabel(category) }));
  readonly filteredCompositionIngredients$ = combineLatest([
    this.ingredientService.ingredientIndex$,
    defer(() => this.compositionSearch.valueChanges.pipe(
      startWith(this.compositionSearch.value),
      map(query => query.trim().length >= MIN_SEARCH_LENGTH ? query : ''),
      searchTerms(),
    )),
    defer(() => this.compositionCategoryFilter.valueChanges.pipe(startWith(this.compositionCategoryFilter.value))),
    defer(() => this.ingredientForm.controls.derivedFromIds.valueChanges.pipe(startWith(this.ingredientForm.controls.derivedFromIds.value))),
  ]).pipe(
    map(([index, query, category, selectedIds]) => {
      if (normalizeSearch(query).length < MIN_SEARCH_LENGTH && !category) return [];
      const filtered = findIngredients(index, query, { category, excludeElaborations: true,
        excludedIds: new Set([...selectedIds, ...(this.ingredientToEdit ? [this.ingredientToEdit.id] : [])]),
      });
      return this.groupIngredients(filtered);
    }),
  );
  readonly recipeForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]], ingredientIds: this.fb.nonNullable.control<string[]>([]),
    ingredientAmounts: this.fb.nonNullable.control<Record<string, RecipeIngredientAmount>>({}), minutes: this.fb.control<number | null>(null), servings: this.fb.control<number | null>(2, [Validators.min(1)]),
    steps: [''], pending: ['yes', Validators.required], mealTypes: this.fb.nonNullable.control<MealType[]>([]), cuisineTypes: this.fb.nonNullable.control<CuisineType[]>([]),
    rating: this.fb.control<number | null>(null, [Validators.min(1), Validators.max(10)]), sourceUrl: [''], annotations: [''], fitness: [false], difficulty: this.fb.nonNullable.control<RecipeDifficulty>('Media')
  });
  readonly selectedIngredients$ = combineLatest([
    this.ingredientService.ingredientIndex$,
    this.selectedIngredientIdsSubject,
  ]).pipe(
    map(([index, selectedIds]) => selectedIngredients(index.byId, selectedIds)
      .sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'))),
  );
  readonly ingredientForm = this.fb.nonNullable.group({
    name: ['', Validators.required],
    category: ['' as IngredientCategory | '', Validators.required],
    measures: ingredientMeasuresForm(),
    derivedFromIds: this.fb.nonNullable.control<string[]>([]),
    derivedFromAmounts: this.fb.nonNullable.control<Record<string, RecipeIngredientAmount>>({}),
  });
  readonly selectedCompositionIngredients$ = combineLatest([
    this.ingredientService.ingredientIndex$,
    defer(() => this.ingredientForm.controls.derivedFromIds.valueChanges.pipe(startWith(this.ingredientForm.controls.derivedFromIds.value))),
  ]).pipe(
    map(([index, selectedIds]) => selectedIngredients(index.byId, selectedIds)
      .sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'))),
  );

  constructor() {
    this.ingredientSearch.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      this.newIngredientName.setValue(query.trim());
    });
    this.ingredientCategoryFilter.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((category) => {
      this.newIngredientCategory.setValue(category === 'Elaboracion' ? '' : category);
    });
    this.compositionSearch.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(query => this.newCompositionName.setValue(query.trim()));
    this.compositionCategoryFilter.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(category => this.newCompositionCategory.setValue(category));
    this.destroyRef.onDestroy(() => this.newRecipePhotos.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl)));
    this.ingredients$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((ingredients) => {
      // The service starts with an empty list while Supabase loads. Do not erase
      // selected IDs from an edit form during that initial empty emission.
      if (ingredients.length === 0) return;
      const validIds = new Set(ingredients.map((item) => item.id));
      const ids = this.recipeForm.controls.ingredientIds.value.filter((id) => validIds.has(id));
      this.recipeForm.controls.ingredientIds.setValue(ids);
      this.selectedIngredientIdsSubject.next(ids);
      const amounts = this.recipeForm.controls.ingredientAmounts.value;
      this.recipeForm.controls.ingredientAmounts.setValue(
        Object.fromEntries(Object.entries(amounts).filter(([id]) => ids.includes(id))),
        { emitEvent: false },
      );
      const componentIds = this.ingredientForm.controls.derivedFromIds.value.filter((id) => validIds.has(id));
      this.ingredientForm.controls.derivedFromIds.setValue(componentIds);
      const componentAmounts = this.ingredientForm.controls.derivedFromAmounts.value;
      this.ingredientForm.controls.derivedFromAmounts.setValue(
        Object.fromEntries(Object.entries(componentAmounts).filter(([id]) => componentIds.includes(id))),
        { emitEvent: false },
      );
    });
  }

  ngOnInit(): void {
    this.activeRecipeTab = 0;
    if (this.recipeToEdit) {
      this.retainedRecipePhotos = [...(this.recipeToEdit.photos ?? [])].sort((a, b) => a.position - b.position);
      this.recipeForm.patchValue({
        ...this.recipeToEdit,
        ingredientAmounts: this.recipeToEdit.ingredientAmounts ?? {},
        steps: this.recipeToEdit.steps.join('\n'),
        pending: this.recipeToEdit.pending ? 'yes' : 'no',
        cuisineTypes: this.recipeToEdit.cuisineTypes ?? [],
        annotations: this.recipeToEdit.annotations ?? '',
        fitness: this.recipeToEdit.fitness ?? false,
      });
      this.selectedIngredientIdsSubject.next(this.recipeForm.controls.ingredientIds.value);
    }
    if (this.ingredientToEdit) {
      this.ingredientForm.patchValue({
        ...this.ingredientToEdit,
        derivedFromIds: this.ingredientToEdit.derivedFromIds ?? [],
        derivedFromAmounts: this.ingredientToEdit.derivedFromAmounts ?? {},
      });
      this.ingredientForm.controls.measures.patchValue({ baseUnit: ingredientBaseUnit(this.ingredientToEdit),
        unitsEnabled: positiveQuantity(this.ingredientToEdit.unitQuantity), unitQuantity: this.ingredientToEdit.unitQuantity ?? null });
    }
    void this.loadIngredients().catch(() => undefined);
  }

  private async loadIngredients(refresh = false): Promise<void> {
    const editing = this.formType === 'ingredient' ? this.ingredientToEdit : null;
    if (editing) this.ingredientDetailsReady.set(false);
    await (refresh ? this.ingredientService.refresh() : this.ingredientService.ensureLoaded());
    if (editing) {
      const ingredient = await this.ingredientService.ensureDetails(editing.id);
      if (this.destroyRef.destroyed) return;
      if (!ingredient) { this.notifications.error('El ingrediente ya no está disponible.'); return; }
      if (!this.ingredientForm.dirty) { this.ingredientForm.patchValue({
        name: ingredient.name, category: ingredient.category,
        derivedFromIds: ingredient.derivedFromIds ?? [], derivedFromAmounts: ingredient.derivedFromAmounts ?? {},
      });
        this.ingredientForm.controls.measures.patchValue({ baseUnit: ingredientBaseUnit(ingredient),
          unitsEnabled: positiveQuantity(ingredient.unitQuantity), unitQuantity: ingredient.unitQuantity ?? null });
        this.compositionAmountControls.clear();
      }
    }
    if (!this.destroyRef.destroyed) this.ingredientDetailsReady.set(true);
  }

  isSelected(id: string): boolean { return this.recipeForm.controls.ingredientIds.value.includes(id); }
  setRating(value: number): void { this.recipeForm.controls.rating.setValue(value); }
  clearRating(): void { this.recipeForm.controls.rating.setValue(null); }
  get recipePhotoCount(): number { return this.retainedRecipePhotos.length + this.newRecipePhotos.length; }
  addRecipePhotos(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.acceptRecipePhotos(input.files ?? []);
    input.value = '';
  }
  onPhotoDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.photoDropActive = true;
  }
  onPhotoDragLeave(event: DragEvent): void {
    const zone = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && zone.contains(event.relatedTarget)) return;
    this.photoDropActive = false;
  }
  onPhotoDrop(event: DragEvent): void {
    event.preventDefault();
    this.photoDropActive = false;
    this.acceptRecipePhotos(event.dataTransfer?.files ?? []);
  }
  private acceptRecipePhotos(fileList: FileList | File[]): void {
    const files = Array.from(fileList);
    const remaining = Math.max(0, 3 - this.recipePhotoCount);
    if (files.length > remaining) this.notifications.error('Puedes añadir hasta 3 fotos por receta.');
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
    for (const file of files.slice(0, remaining)) {
      if (!allowedTypes.has(file.type)) { this.notifications.error(`${file.name} no es un formato compatible. Usa JPG, PNG, WebP, GIF o AVIF.`); continue; }
      if (file.size > 5 * 1024 * 1024) { this.notifications.error(`${file.name} supera el límite de 5 MB.`); continue; }
      this.newRecipePhotos.push({ file, previewUrl: URL.createObjectURL(file) });
    }
  }
  removeRecipePhoto(photoId: string): void { this.retainedRecipePhotos = this.retainedRecipePhotos.filter((photo) => photo.id !== photoId); }
  removeNewRecipePhoto(index: number): void {
    const [removed] = this.newRecipePhotos.splice(index, 1);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
  }
  isCompositionSelected(id: string): boolean {
    return this.ingredientForm.controls.derivedFromIds.value.includes(id);
  }
  addCompositionIngredient(id: string): void {
    const ingredient = this.ingredientService.getById(id);
    if (!ingredient || ingredient.category === 'Elaboracion' || id === this.ingredientToEdit?.id || this.isCompositionSelected(id)) return;
    this.toggleCompositionIngredient(id);
  }
  removeCompositionIngredient(id: string): void {
    if (this.isCompositionSelected(id)) this.toggleCompositionIngredient(id);
  }
  private toggleCompositionIngredient(id: string): void {
    const selected = this.ingredientForm.controls.derivedFromIds.value;
    const wasSelected = selected.includes(id);
    this.ingredientForm.controls.derivedFromIds.setValue(wasSelected ? selected.filter((value) => value !== id) : [...selected, id]);
    this.ingredientForm.controls.derivedFromIds.markAsTouched();
    if (wasSelected) { this.setCompositionAmount(id, null); this.compositionAmountControls.delete(id); }
  }
  compositionAmount(id: string): RecipeIngredientAmount | null {
    return this.ingredientForm.controls.derivedFromAmounts.value[id] ?? null;
  }
  compositionAmountControl(id: string): FormControl<RecipeIngredientAmount | null> {
    let control = this.compositionAmountControls.get(id);
    if (!control) {
      control = this.fb.control(this.compositionAmount(id));
      this.compositionAmountControls.set(id, control);
      const current = control;
      control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(amount => {
        if (this.compositionAmountControls.get(id) === current) this.setCompositionAmount(id, amount);
      });
    }
    return control;
  }
  private setCompositionAmount(id: string, amount: RecipeIngredientAmount | null): void {
    const amounts = { ...this.ingredientForm.controls.derivedFromAmounts.value };
    if (amount) amounts[id] = amount;
    else delete amounts[id];
    this.ingredientForm.controls.derivedFromAmounts.setValue(amounts);
  }
  private groupIngredients(ingredients: Ingredient[]): IngredientGroup[] {
    return groupIngredients(ingredients, this.categories);
  }
  categoryLabel(category: IngredientCategory): string { return ingredientCategoryLabel(category); }
  hasMealType(type: MealType): boolean { return this.recipeForm.controls.mealTypes.value.includes(type); }
  hasCuisineType(type: CuisineType): boolean { return this.recipeForm.controls.cuisineTypes.value.includes(type); }
  toggleCuisineType(type: CuisineType): void {
    const selected = this.recipeForm.controls.cuisineTypes.value;
    this.recipeForm.controls.cuisineTypes.setValue(selected.includes(type) ? selected.filter((value) => value !== type) : [...selected, type]);
  }
  addRecipeIngredient(id: string): void {
    if (this.isSelected(id)) return;
    this.toggleIngredient(id);
    this.ingredientSearch.setValue('');
  }
  createRecipeIngredient(): Promise<void> { return this.createPickerIngredient('recipe'); }
  createCompositionIngredient(): Promise<void> { return this.createPickerIngredient('composition'); }
  private async createPickerIngredient(target: 'recipe' | 'composition'): Promise<void> {
    if (this.busy() || !this.ingredientService.loaded() || this.ingredientService.error()) return;
    const nameControl = target === 'recipe' ? this.newIngredientName : this.newCompositionName;
    const categoryControl = target === 'recipe' ? this.newIngredientCategory : this.newCompositionCategory;
    const measures = target === 'recipe' ? this.newIngredientMeasures : this.newCompositionMeasures;
    measures.markAllAsTouched();
    nameControl.markAsTouched(); categoryControl.markAsTouched();
    const name = nameControl.value.trim();
    const category = categoryControl.value;
    if (!name || !category || measures.invalid) return;

    this.addingIngredient.set(true);
    try {
      const index = await firstValueFrom(this.ingredientService.ingredientIndex$);
      const existing = index.byName.get(normalizeSearch(name));
      if (target === 'composition' && existing && (existing.category === 'Elaboracion' || existing.id === this.ingredientToEdit?.id)) {
        this.notifications.error('Los componentes deben ser ingredientes simples, distintos de la elaboración que estás editando.');
        return;
      }
      const ingredient = existing ?? await this.ingredientService.add(name, category, [], {}, measuresFormValue(measures));
      if (this.destroyRef.destroyed) return;
      if (target === 'recipe') this.addRecipeIngredient(ingredient.id);
      else this.addCompositionIngredient(ingredient.id);
      (target === 'recipe' ? this.ingredientSearch : this.compositionSearch).setValue('');
      this.notifications.success(existing ? `${ingredient.name} ya existe y se ha seleccionado.` : `${ingredient.name} añadido y seleccionado.`);
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'No se pudo guardar el ingrediente.');
    } finally {
      this.addingIngredient.set(false);
    }
  }
  removeRecipeIngredient(id: string): void {
    if (this.isSelected(id)) this.toggleIngredient(id);
  }
  private toggleIngredient(id: string): void {
    const selected = this.recipeForm.controls.ingredientIds.value;
    const wasSelected = selected.includes(id);
    this.recipeForm.controls.ingredientIds.setValue(wasSelected ? selected.filter((value) => value !== id) : [...selected, id]);
    this.selectedIngredientIdsSubject.next(this.recipeForm.controls.ingredientIds.value);
    if (wasSelected) { this.setIngredientAmount(id, null); this.recipeAmountControls.delete(id); }
    this.recipeForm.controls.ingredientIds.markAsTouched();
  }
  ingredientAmount(id: string): RecipeIngredientAmount | null {
    return this.recipeForm.controls.ingredientAmounts.value[id] ?? null;
  }
  ingredientAmountControl(id: string): FormControl<RecipeIngredientAmount | null> {
    let control = this.recipeAmountControls.get(id);
    if (!control) {
      control = this.fb.control(this.ingredientAmount(id));
      this.recipeAmountControls.set(id, control);
      const current = control;
      control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(amount => {
        if (this.recipeAmountControls.get(id) === current) this.setIngredientAmount(id, amount);
      });
    }
    return control;
  }
  setRecipeTab(tab: number): void {
    if (tab < 0 || tab >= this.recipeTabLabels.length || tab === this.activeRecipeTab) return;
    if (tab > this.activeRecipeTab && !this.validateRecipeDetails()) return;
    if (tab > 1 && !this.validateRecipeIngredients()) return;
    this.activeRecipeTab = tab;
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
      return !allowedIngredientAmount(amount ?? null, this.ingredientService.getById(id), this.recipeToEdit?.ingredientAmounts?.[id]);
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
  busy(): boolean { return this.savingRecipe || this.savingIngredient() || this.addingIngredient(); }
  requestCancel(): void { if (!this.busy()) this.cancel.emit(); }
  retryIngredients(): void { void this.loadIngredients(true).catch(() => undefined); }

  saveRecipe(): void {
    if (this.busy() || !this.ingredientService.loaded() || this.ingredientService.error()) return;
    if (!this.validateRecipeDetails()) { this.activeRecipeTab = 0; return; }
    this.recipeForm.controls.ingredientIds.markAsTouched();
    if (this.recipeForm.controls.ingredientIds.value.length === 0) { this.activeRecipeTab = 1; return; }
    if (this.recipeForm.invalid) { this.recipeForm.markAllAsTouched(); this.activeRecipeTab = 0; return; }
    const value = this.recipeForm.getRawValue();
    if (value.rating !== null && (!Number.isInteger(value.rating) || value.rating < 1 || value.rating > 10)) { this.activeRecipeTab = 0; this.notifications.error('La valoración debe ser un número entero del 1 al 10.'); return; }
    if (value.minutes !== null && value.minutes < 1) { this.activeRecipeTab = 0; this.notifications.error('El tiempo debe ser mayor que cero minutos.'); return; }
    if (value.servings !== null && (!Number.isInteger(value.servings) || value.servings < 1)) { this.activeRecipeTab = 0; this.notifications.error('Indica un número entero de comensales mayor que cero.'); return; }
    const hasIncompleteAmount = value.ingredientIds.some((id) => {
      const amount = value.ingredientAmounts[id];
      return !allowedIngredientAmount(amount ?? null, this.ingredientService.getById(id), this.recipeToEdit?.ingredientAmounts?.[id]);
    });
    if (hasIncompleteAmount) { this.activeRecipeTab = 1; this.notifications.error('Indica una cantidad mayor que cero o elige otra opción.'); return; }
    this.recipeSaved.emit({
      ...value,
      steps: value.steps.split('\n').map((step) => step.trim()).filter(Boolean),
      photos: this.retainedRecipePhotos,
      photoFiles: this.newRecipePhotos.map(({ file }) => file),
    });
  }
  async saveIngredient(): Promise<void> {
    if (this.busy() || !this.ingredientDetailsReady() || !this.ingredientService.loaded() || this.ingredientService.error()) return;
    this.savingIngredient.set(true);
    try { await this.performSaveIngredient(); }
    finally { this.savingIngredient.set(false); }
  }
  private async performSaveIngredient(): Promise<void> {
    this.ingredientForm.markAllAsTouched();
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
      return !allowedIngredientAmount(amount ?? null, this.ingredientService.getById(id), this.ingredientToEdit?.derivedFromAmounts?.[id]);
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
        ...measuresFormValue(this.ingredientForm.controls.measures),
      }); } catch (error) { this.notifications.error(error instanceof Error ? error.message : 'No se pudo actualizar el ingrediente.'); return; }
      this.notifications.success(`${value.name} actualizado.`);
      this.cancel.emit();
      return;
    }
    try { await this.ingredientService.add(value.name, value.category as IngredientCategory, derivedFromIds, derivedFromAmounts, measuresFormValue(this.ingredientForm.controls.measures)); }
    catch (error) { this.notifications.error(error instanceof Error ? error.message : 'No se pudo guardar el ingrediente.'); return; }
    this.notifications.success(`${value.name} añadido a tus ingredientes.`);
    this.cancel.emit();
  }
}




