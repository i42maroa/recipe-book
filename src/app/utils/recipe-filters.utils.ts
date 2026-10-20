import { Observable, combineLatest, distinctUntilChanged, filter, map, of } from 'rxjs';
import { MealType, RecipeDifficulty } from '../models/recipe.model';
import type { RecipeFilters } from '../services/recipe.service';
import { ValueSource, controlValues, isCompleteSearch, recipeSearch } from './search.utils';

interface RecipeFilterControls {
  search: ValueSource<string>;
  sort: ValueSource<string>;
  mealType: ValueSource<MealType | ''>;
  difficulty: ValueSource<RecipeDifficulty | ''>;
  ingredientIds: ValueSource<string[]>;
}

/** One canonical key for equality and cache lookups, independent of tag order. */
export function recipeFilterKey(filters: RecipeFilters): string {
  return JSON.stringify([filters.search.trim(), filters.pending, filters.sort, filters.mealType, filters.difficulty,
    [...new Set(filters.ingredientIds ?? [])].sort()]);
}

export function recipeFilterChanges(controls: RecipeFilterControls, options: {
  pending?: Observable<string>; initialSearch?: string; ignoreIncomplete?: boolean; deduplicate?: boolean;
} = {}): Observable<RecipeFilters> {
  let search = recipeSearch(controls.search, options.initialSearch);
  if (options.ignoreIncomplete) search = search.pipe(filter(isCompleteSearch));
  const changes = combineLatest([
    search, options.pending ?? of('all'), controlValues(controls.sort), controlValues(controls.mealType),
    controlValues(controls.difficulty), controlValues(controls.ingredientIds),
  ]).pipe(
    map(([search, pending, sort, mealType, difficulty, ingredientIds]) => ({
      search, pending, sort, mealType, difficulty, ingredientIds: [...new Set(ingredientIds)],
    })),
  );
  // Pickers clear stale selectable results immediately on typing, so even a
  // return to the previous term must emit again to restore those results.
  return options.deduplicate === false ? changes : changes.pipe(distinctUntilChanged((a, b) => recipeFilterKey(a) === recipeFilterKey(b)));
}
