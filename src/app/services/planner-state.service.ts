import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { skip } from 'rxjs';
import { RecipeCard } from '../models/recipe-card.model';
import { RecipeSummary } from '../models/scheduled-meal.model';
import { AuthService } from './auth.service';
import { RecipeFilters, RecipeService } from './recipe.service';
import { ScheduledMealService } from './scheduled-meal.service';
import { recipeFilterKey } from '../utils/recipe-filters.utils';

export interface PickerSnapshot {
  items: RecipeCard[];
  total: number;
  offset: number;
}

const defaultFilters = (): RecipeFilters => ({ search: '', pending: 'all', sort: 'recent', mealType: '', difficulty: '' });
const TTL = 300_000;

/** Bounded, private navigation state. Nothing is persisted in browser storage. */
@Injectable({ providedIn: 'root' })
export class PlannerStateService {
  private readonly auth = inject(AuthService);
  private readonly recipes = inject(RecipeService);
  private readonly meals = inject(ScheduledMealService);
  private owner: string | undefined;
  private revision = 0;
  private filters = defaultFilters();
  pickerFiltersExpanded = false;
  private readonly summaries = new Map<string, { value: RecipeSummary | undefined; expires: number }>();
  private readonly cards = new Map<string, { value: RecipeCard | undefined; expires: number }>();
  private readonly pages = new Map<string, { value: PickerSnapshot; expires: number }>();

  constructor() {
    effect(() => { this.syncOwner(); });
    this.recipes.changes$.pipe(skip(1), takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.invalidateRecipes());
  }

  private syncOwner(): string | undefined {
    const owner = this.auth.canEdit() ? this.auth.user()?.id : undefined;
    if (owner !== this.owner) {
      this.owner = owner; this.filters = defaultFilters(); this.pickerFiltersExpanded = false; this.invalidateRecipes();
    }
    return owner;
  }

  private invalidateRecipes(): void {
    this.revision++; this.summaries.clear(); this.cards.clear(); this.pages.clear();
  }

  get pickerFilters(): RecipeFilters { this.syncOwner(); return structuredClone(this.filters); }
  set pickerFilters(filters: RecipeFilters) { this.syncOwner(); this.filters = structuredClone(filters); }

  pickerPage(filters: RecipeFilters): PickerSnapshot | undefined {
    if (!this.syncOwner()) return undefined;
    const page = this.pages.get(this.filterKey(filters));
    return page && page.expires > Date.now() ? structuredClone(page.value) : undefined;
  }

  rememberPicker(filters: RecipeFilters, page: PickerSnapshot): void {
    if (!this.syncOwner()) return;
    const key = this.filterKey(filters);
    this.pages.delete(key);
    // Keep pagination responsive without retaining unbounded recipe collections.
    if (page.items.length <= 200) this.pages.set(key, { value: structuredClone(page), expires: Date.now() + TTL });
    while (this.pages.size > 8) this.pages.delete(this.pages.keys().next().value!);
  }

  private filterKey(filters: RecipeFilters): string {
    return recipeFilterKey(filters);
  }

  rememberCard(card: RecipeCard): void {
    if (!this.syncOwner()) return;
    this.cards.delete(card.id); this.summaries.delete(card.id);
    this.cards.set(card.id, { value: structuredClone(card), expires: Date.now() + TTL });
    this.summaries.set(card.id, { value: structuredClone(card), expires: Date.now() + TTL });
    this.trimMetadata();
  }

  async recipeData(ids: string[], full: boolean, signal: AbortSignal): Promise<{ cards: Record<string, RecipeCard>; summaries: Record<string, RecipeSummary> }> {
    const owner = this.syncOwner();
    if (!owner) throw new Error('Necesitas una sesión autorizada.');
    const revision = this.revision;
    const cache = full ? this.cards : this.summaries;
    const unique = [...new Set(ids)];
    const missing = unique.filter(id => (cache.get(id)?.expires ?? 0) <= Date.now());
    if (missing.length) {
      if (full) {
        const rows = await this.recipes.getCardsByIds(missing, signal);
        this.checkRequest(owner, revision, signal);
        for (const id of missing) this.cards.set(id, { value: undefined, expires: Date.now() + TTL });
        for (const card of rows) this.rememberCard(card);
      } else {
        const rows = await this.meals.recipeSummaries(missing, signal);
        this.checkRequest(owner, revision, signal);
        for (const id of missing) this.summaries.set(id, { value: rows[id], expires: Date.now() + TTL });
      }
    }
    this.checkRequest(owner, revision, signal);
    const cards: Record<string, RecipeCard> = {};
    const summaries: Record<string, RecipeSummary> = {};
    for (const id of unique) {
      const card = this.cards.get(id)?.value;
      const summary = full ? card : this.summaries.get(id)?.value;
      if (card) cards[id] = structuredClone(card);
      if (summary) summaries[id] = structuredClone(summary);
    }
    this.trimMetadata();
    return { cards, summaries };
  }

  private checkRequest(owner: string, revision: number, signal: AbortSignal): void {
    signal.throwIfAborted();
    if (this.syncOwner() !== owner || this.revision !== revision) throw new Error('Los datos han cambiado. Vuelve a intentarlo.');
  }

  private trimMetadata(): void {
    while (this.cards.size > 300) this.cards.delete(this.cards.keys().next().value!);
    while (this.summaries.size > 300) this.summaries.delete(this.summaries.keys().next().value!);
  }
}
