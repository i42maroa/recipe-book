import { Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { skip } from 'rxjs';
import { RecipeCard } from '../../models/recipe-card.model';
import { MealType, RecipeDifficulty } from '../../models/recipe.model';
import { AuthService } from '../../services/auth.service';
import { InventoryService } from '../../services/inventory.service';
import { InventoryIngredientPlanningService } from '../../services/inventory-ingredient-planning.service';
import { RecipeFilters, RecipeService } from '../../services/recipe.service';
import { plannerInventoryIngredients } from '../../utils/planner-inventory.utils';
import { recipeFilterChanges } from '../../utils/recipe-filters.utils';
import { controlValues, isCompleteSearch } from '../../utils/search.utils';
import { RecipeCardComponent } from '../recipe-card/recipe-card.component';
import { RecipeFiltersComponent } from '../shared/filters/recipe-filters/recipe-filters.component';

@Component({
  selector: 'app-planner-stock-recipes', standalone: true,
  imports: [RouterLink, RecipeCardComponent, RecipeFiltersComponent],
  templateUrl: './planner-stock-recipes.component.html', styleUrl: './planner-stock-recipes.component.css',
})
export class PlannerStockRecipesComponent implements OnInit {
  readonly excludedRecipeIds = input<string[]>([]);
  readonly selected = output<RecipeCard>();
  private readonly inventory = inject(InventoryService);
  readonly ingredientPlanning = inject(InventoryIngredientPlanningService);
  private readonly recipes = inject(RecipeService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly owner = this.auth.user()?.id;
  readonly inventoryIngredients = computed(() => plannerInventoryIngredients(this.inventory.places()));
  readonly ingredientIds = computed(() => this.inventoryIngredients().filter(ingredient => !this.ingredientPlanning.isPlanned(ingredient.id)).map(ingredient => ingredient.id).sort());
  readonly plannedIngredients = computed(() => this.inventoryIngredients().filter(ingredient => this.ingredientPlanning.isPlanned(ingredient.id)));
  readonly search = new FormControl('', { nonNullable: true });
  readonly sort = new FormControl('recent', { nonNullable: true });
  readonly mealType = new FormControl<MealType | ''>('', { nonNullable: true });
  readonly difficulty = new FormControl<RecipeDifficulty | ''>('', { nonNullable: true });
  readonly status = new FormControl('all', { nonNullable: true });
  readonly filterIngredients = new FormControl<string[]>([], { nonNullable: true });
  readonly results = signal<RecipeCard[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly error = signal('');
  private started = false;
  private readInventory = false;
  private readPlanning = false;
  private selectedOnce = false;
  private loadedIds = '';
  private revision = 0;
  private offset = 0;
  private request: AbortController | undefined;
  private filters: RecipeFilters = { search: '', pending: 'all', sort: 'recent', mealType: '', difficulty: '' };

  constructor() {
    this.destroyRef.onDestroy(() => { this.revision++; this.request?.abort(); });
    this.search.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.revision++; this.request?.abort(); this.results.set([]); this.total.set(0); this.loading.set(isCompleteSearch(this.search.value));
    });
    recipeFilterChanges({ search: this.search, sort: this.sort, mealType: this.mealType, difficulty: this.difficulty,
      ingredientIds: this.filterIngredients }, { pending: controlValues(this.status), deduplicate: false })
      .pipe(takeUntilDestroyed()).subscribe(filters => {
        if (this.search.value.trim() !== filters.search) return;
        this.filters = filters; if (this.started) void this.load();
      });
    this.recipes.changes$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => { if (this.started) void this.load(); });
    effect(() => {
      const signature = this.ingredientIds().join(',');
      if (this.started && this.inventory.ready() && this.ingredientPlanning.ready() && !this.ingredientPlanning.loading()
        && signature !== this.loadedIds) untracked(() => { void this.load(); });
    });
  }
  ngOnInit(): void { this.started = true; void this.load(); }
  private active(): boolean { return !this.destroyRef.destroyed && this.auth.canEdit() && this.auth.user()?.id === this.owner; }

  async load(more = false): Promise<void> {
    if (!isCompleteSearch(this.search.value) || this.search.value.trim() !== this.filters.search) return;
    const revision = ++this.revision; this.request?.abort(); const request = this.request = new AbortController();
    this.loading.set(true); this.error.set('');
    if (!more) { this.offset = 0; this.results.set([]); this.total.set(0); }
    const active = (): boolean => this.active() && !request.signal.aborted && revision === this.revision;
    try {
      const refreshStock = !this.inventory.dirty() && !this.inventory.saving() && (!this.readInventory || !!this.inventory.error());
      const refreshPlanning = !this.readPlanning;
      this.readInventory = true; this.readPlanning = true;
      await Promise.all([this.inventory.load(refreshStock), this.ingredientPlanning.load(refreshPlanning)]);
      if (!active()) return;
      if (!this.inventory.ready() || this.inventory.error()) throw new Error(this.inventory.error() || 'No se pudo cargar el inventario.');
      if (!this.ingredientPlanning.ready() || this.ingredientPlanning.error()) throw new Error(this.ingredientPlanning.error() || 'No se pudieron comprobar los ingredientes planificados.');
      const ids = this.ingredientIds(); this.loadedIds = ids.join(',');
      // Empty stock must not accidentally issue an unfiltered catalogue query.
      if (!ids.length) { this.results.set([]); this.total.set(0); return; }
      const page = await this.recipes.getBatch({ ...this.filters, ingredientIds: ids, ingredientMatch: undefined }, more ? this.offset : 0, 20, request.signal);
      if (!active() || !this.ingredientPlanning.ready() || this.ingredientPlanning.error() || this.loadedIds !== this.ingredientIds().join(',')) return;
      this.offset = page.offset + page.items.length; this.total.set(page.total);
      this.results.update(items => more ? [...items, ...page.items] : page.items);
    } catch (error) { if (active()) this.error.set(error instanceof Error ? error.message : 'No se pudieron buscar las recetas con tus ingredientes.'); }
    finally { if (active()) this.loading.set(false); }
  }
  isAdded(id: string): boolean { return this.excludedRecipeIds().some(value => value.toLowerCase() === id.toLowerCase()); }
  select(recipe: RecipeCard): void {
    if (!this.active() || this.loading() || this.selectedOnce || this.isAdded(recipe.id) || !this.ingredientPlanning.ready()
      || this.ingredientPlanning.loading() || this.ingredientPlanning.error() || this.loadedIds !== this.ingredientIds().join(',')) return;
    this.selectedOnce = true; this.selected.emit(recipe);
  }
}
