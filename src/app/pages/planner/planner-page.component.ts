import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RecipeCardComponent } from '../../components/recipe-card/recipe-card.component';
import { SkeletonComponent } from '../../components/shared/skeleton/skeleton.component';
import { RecipeCard } from '../../models/recipe-card.model';
import { MEAL_SLOTS, ScheduledMeal } from '../../models/scheduled-meal.model';
import { AuthService } from '../../services/auth.service';
import { PlannerStateService } from '../../services/planner-state.service';
import { ScheduledMealService } from '../../services/scheduled-meal.service';
import { calendarWeek, localDate } from '../../utils/scheduled-meal.utils';

/** Read-only overview. Editing lives exclusively at /planner/day and /planner/week. */
@Component({
  selector: 'app-planner-page',
  standalone: true,
  imports: [RouterLink, RecipeCardComponent, SkeletonComponent],
  templateUrl: './planner-page.component.html',
  styleUrl: './planner-page.component.css',
})
export class PlannerPageComponent {
  private readonly auth = inject(AuthService);
  private readonly meals = inject(ScheduledMealService);
  private readonly state = inject(PlannerStateService);
  private readonly router = inject(Router);
  private readonly owner = this.auth.user()?.id;
  private alive = true;
  private revision = 0;
  private request: AbortController | undefined;
  readonly day = calendarWeek(localDate())[0];
  readonly slots = MEAL_SLOTS;
  readonly selections = signal<ScheduledMeal[]>([]);
  readonly cards = signal<Record<string, RecipeCard>>({});
  readonly sections = computed(() => this.slots.map(slot => ({
    ...slot, recipes: this.selections().find(meal => meal.slot === slot.id)?.recipes ?? [],
  })).filter(meal => meal.recipes.length));
  readonly loading = signal(true);
  readonly error = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.alive = false; this.revision++; this.request?.abort(); });
    effect(() => {
      if (!this.auth.canEdit() || this.auth.user()?.id !== this.owner) {
        this.request?.abort(); this.selections.set([]); this.cards.set({});
        void this.router.navigate(['/login']);
      }
    });
    void this.load();
  }

  private active(revision: number): boolean {
    return this.alive && revision === this.revision && this.auth.user()?.id === this.owner && this.auth.canEdit();
  }

  async load(): Promise<void> {
    const revision = ++this.revision;
    this.request?.abort();
    const request = this.request = new AbortController();
    this.loading.set(true); this.error.set(false);
    try {
      const meals = await this.meals.getDay(this.day.date, request.signal);
      if (!this.active(revision)) return;
      const ids = meals.flatMap(meal => meal.recipes.map(recipe => recipe.recipeId));
      const { cards } = await this.state.recipeData(ids, true, request.signal);
      if (!this.active(revision)) return;
      this.selections.set(meals); this.cards.set(cards);
    } catch { if (this.active(revision)) this.error.set(true); }
    finally { if (this.active(revision)) this.loading.set(false); }
  }

  showRecipe(recipe: RecipeCard): void {
    void this.router.navigate(['/recipes', recipe.id], { queryParams: { fromPlanner: 'today' } });
  }
}
