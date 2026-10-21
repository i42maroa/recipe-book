import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { IngredientService } from '../../../../services/ingredient.service';
import { SearchFilterComponent } from '../search-filter/search-filter.component';
import { IconComponent } from '../../icon/icon.component';
import { MIN_SEARCH_LENGTH, normalizeSearch } from '../../../../utils/search.utils';
import { findIngredients, indexIngredients } from '../../../../utils/ingredient-search.utils';
import { INGREDIENT_CATEGORIES, IngredientCategory } from '../../../../models/recipe.model';
import { ingredientCategoryLabel } from '../../../../utils/recipe-display.utils';
import { SelectFilterComponent } from '../select-filter/select-filter.component';
import { SelectFilterOption } from '../select-filter-options';
import { AuthService } from '../../../../services/auth.service';
import { NotificationService } from '../../../../services/notification.service';
import { distinctUntilChanged, startWith } from 'rxjs';

@Component({
  selector: 'app-ingredient-filter',
  standalone: true,
  imports: [ReactiveFormsModule, SearchFilterComponent, SelectFilterComponent, IconComponent],
  templateUrl: './ingredient-filter.component.html',
  styleUrl: './ingredient-filter.component.css',
})
export class IngredientFilterComponent {
  readonly ingredients = inject(IngredientService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  readonly selectedIds = input<string[]>([]);
  readonly selectedIdsChange = output<string[]>();
  readonly purpose = input<'recipe-filter' | 'shopping'>('recipe-filter');
  readonly showSelected = input(true);
  readonly disabled = input(false);
  readonly addingIngredient = signal(false);
  readonly createError = signal('');
  readonly search = new FormControl('', { nonNullable: true });
  readonly category = new FormControl<IngredientCategory | ''>('', { nonNullable: true });
  readonly categoryOptions: SelectFilterOption[] = [
    { value: '', label: 'Todas las categorías' },
    ...INGREDIENT_CATEGORIES
      .map(category => ({ value: category, label: ingredientCategoryLabel(category) })),
  ];
  readonly newCategory = new FormControl<IngredientCategory | ''>('', { nonNullable: true, validators: [Validators.required] });
  readonly newCategoryOptions = this.categoryOptions.filter(option => option.value && option.value !== 'Elaboracion');
  private readonly query = toSignal(this.search.valueChanges, { initialValue: '' });
  readonly selectedCategory = toSignal(this.category.valueChanges, { initialValue: this.category.value });
  private readonly catalog = toSignal(this.ingredients.ingredientIndex$, { initialValue: indexIngredients([]) });
  readonly newName = computed(() => this.query().trim());
  readonly canCreate = computed(() => this.purpose() === 'shopping' && this.auth.canEdit() && this.ingredients.loaded()
    && !this.ingredients.error() && normalizeSearch(this.newName()).length >= MIN_SEARCH_LENGTH
    && !this.catalog().byName.has(normalizeSearch(this.newName())));
  private readonly selectedSet = computed(() => new Set(this.selectedIds()));
  readonly searching = computed(() => normalizeSearch(this.query()).length >= MIN_SEARCH_LENGTH || !!this.selectedCategory());
  readonly selected = computed(() => this.selectedIds().map(id => ({ id, name: this.catalog().byId.get(id)?.name ?? 'Ingrediente' })));
  readonly results = computed(() => this.searching() ? findIngredients(this.catalog(), this.query(), { category: this.selectedCategory(), excludedIds: this.selectedSet() }) : []);

  constructor() {
    this.search.valueChanges.pipe(startWith(this.search.value), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.createError.set(''));
    this.category.valueChanges.pipe(startWith(this.category.value), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(category => this.newCategory.setValue(category === 'Elaboracion' ? '' : category));
    void this.ingredients.ensureLoaded().catch(() => undefined);
  }

  add(id: string): void {
    if (this.disabled() || this.addingIngredient()) return;
    if (!this.selectedSet().has(id)) this.selectedIdsChange.emit([...this.selectedIds(), id]);
    this.search.setValue('');
  }

  async createIngredient(): Promise<void> {
    if (this.disabled() || this.addingIngredient() || !this.canCreate()) return;
    this.newCategory.markAsTouched();
    const name = this.newName(); const category = this.newCategory.value;
    if (!category) return;
    const owner = this.auth.user()?.id;
    this.addingIngredient.set(true); this.createError.set('');
    this.search.disable(); this.category.disable(); this.newCategory.disable();
    try {
      const existing = this.catalog().byName.get(normalizeSearch(name));
      const ingredient = existing ?? await this.ingredients.add(name, category);
      if (this.destroyRef.destroyed || !this.auth.canEdit() || this.auth.user()?.id !== owner) return;
      if (this.disabled()) {
        this.notifications.success(`${ingredient.name} creado. Puedes añadirlo desde el buscador.`);
        return;
      }
      if (!this.selectedSet().has(ingredient.id)) this.selectedIdsChange.emit([...this.selectedIds(), ingredient.id]);
      this.search.setValue('');
      this.notifications.success(`${ingredient.name} creado y añadido a la lista.`);
    } catch (error) {
      if (!this.destroyRef.destroyed && this.auth.user()?.id === owner) {
        this.createError.set(error instanceof Error ? error.message : 'No se pudo crear el ingrediente. Vuelve a intentarlo.');
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.addingIngredient.set(false); this.search.enable(); this.category.enable(); this.newCategory.enable();
      }
    }
  }

  remove(id: string): void { this.selectedIdsChange.emit(this.selectedIds().filter(value => value !== id)); }

  retry(): void { void this.ingredients.refresh().catch(() => undefined); }

}
