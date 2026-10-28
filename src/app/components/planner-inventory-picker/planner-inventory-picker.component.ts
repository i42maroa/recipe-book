import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InventoryItem, InventoryPlace } from '../../models/inventory.model';
import { RecipeCard } from '../../models/recipe-card.model';
import { InventoryRecipeSelection } from '../../models/inventory-planning.model';
import { AuthService } from '../../services/auth.service';
import { InventoryService } from '../../services/inventory.service';
import { InventoryPlanningService } from '../../services/inventory-planning.service';
import { RecipeService } from '../../services/recipe.service';
import { plannerInventoryGroups } from '../../utils/planner-inventory.utils';
import { SearchFilterComponent } from '../shared/filters/search-filter/search-filter.component';
import { IconComponent } from '../shared/icon/icon.component';

@Component({
  selector: 'app-planner-inventory-picker', standalone: true,
  imports: [ReactiveFormsModule, RouterLink, SearchFilterComponent, IconComponent],
  templateUrl: './planner-inventory-picker.component.html',
  styleUrl: './planner-inventory-picker.component.css',
})
export class PlannerInventoryPickerComponent implements OnInit {
  readonly excludedRecipeIds = input<string[]>([]);
  readonly selected = output<InventoryRecipeSelection>();
  readonly inventory = inject(InventoryService);
  readonly planning = inject(InventoryPlanningService);
  private readonly recipes = inject(RecipeService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly owner = this.auth.user()?.id;
  private request: AbortController | undefined;
  private revision = 0;
  private selectedOnce = false;
  readonly search = new FormControl('', { nonNullable: true });
  private readonly query = toSignal(this.search.valueChanges, { initialValue: this.search.value });
  private readonly cards = signal<Record<string, RecipeCard>>({});
  private readonly excluded = computed(() => new Set(this.excludedRecipeIds().map(id => id.toLowerCase())));
  readonly loading = signal(true);
  readonly error = signal('');
  readonly recipesLoading = signal(false);
  readonly recipesError = signal('');
  readonly lots = computed(() => plannerInventoryGroups(this.inventory.places(), this.cards(), this.query())
    .flatMap(place => place.spaces.flatMap(space => space.lots.map(lot => ({ ...lot, place: { id: place.id, name: place.name } })))));

  constructor() { this.destroyRef.onDestroy(() => { this.revision++; this.request?.abort(); }); }
  ngOnInit(): void { void this.load(); void this.planning.load(true); }
  private active(): boolean { return !this.destroyRef.destroyed && this.auth.canEdit() && this.auth.user()?.id === this.owner; }

  async load(): Promise<void> {
    const revision = ++this.revision;
    this.request?.abort();
    const request = this.request = new AbortController();
    this.loading.set(true); this.error.set(''); this.cards.set({}); this.recipesError.set(''); this.recipesLoading.set(false);
    try {
      // Never replace unsaved inventory changes just to open the planning selector.
      await this.inventory.load(!!this.inventory.error() && !this.inventory.dirty());
      if (!this.active() || request.signal.aborted || revision !== this.revision) return;
      if (this.inventory.error() || !this.inventory.ready()) throw new Error(this.inventory.error() || 'No se pudo cargar el inventario.');
      this.loading.set(false); this.recipesLoading.set(true);
      const ids = [...new Set(this.inventory.places().flatMap(place => place.items.flatMap(item => item.recipeId ? [item.recipeId.toLowerCase()] : [])))];
      try {
        const cards = await this.recipes.getCardsByIds(ids, request.signal);
        if (!this.active() || request.signal.aborted || revision !== this.revision) return;
        this.cards.set(Object.fromEntries(cards.map(recipe => [recipe.id.toLowerCase(), recipe])));
      } catch (error) {
        if (this.active() && !request.signal.aborted && revision === this.revision) this.recipesError.set(error instanceof Error ? error.message : 'No se pudieron cargar los platos del inventario.');
      }
    } catch (error) {
      if (this.active() && !request.signal.aborted && revision === this.revision) this.error.set(error instanceof Error ? error.message : 'No se pudieron cargar las recetas del inventario.');
    } finally {
      if (this.active() && revision === this.revision) { this.loading.set(false); this.recipesLoading.set(false); }
    }
  }

  isAdded(id: string): boolean { return this.excluded().has(id.toLowerCase()); }
  select(recipe: RecipeCard | undefined, item: InventoryItem, place: Pick<InventoryPlace, 'id' | 'name'>): void {
    if (!recipe || !this.active() || this.loading() || this.error() || this.recipesLoading() || this.recipesError() || this.selectedOnce || this.isAdded(recipe.id)) return;
    const current = this.inventory.places().find(value => value.id === place.id)?.items.find(value => value.id === item.id);
    if (!current || current.recipeId?.toLowerCase() !== recipe.id.toLowerCase()) return;
    this.selectedOnce = true;
    this.selected.emit({ recipe, inventory: { placeId: place.id, itemId: item.id, placeName: place.name, space: item.space } });
  }
  dateLabel(date: string): string { return date.split('-').reverse().join('/'); }
}
