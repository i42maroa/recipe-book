import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, UrlTree } from '@angular/router';
import { combineLatest, filter, map, startWith } from 'rxjs';
import { RecipeService } from '../../../services/recipe.service';
import { IngredientService } from '../../../services/ingredient.service';
import { dateNumber } from '../../../utils/scheduled-meal.utils';

interface BreadcrumbItem {
  label: string;
  url: string | UrlTree | null;
}

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [AsyncPipe, RouterLink],
  templateUrl: './breadcrumb.component.html',
  styleUrl: './breadcrumb.component.css',
})
export class BreadcrumbComponent {
  private readonly router = inject(Router);
  private readonly recipeService = inject(RecipeService);
  private readonly ingredientService = inject(IngredientService);

  readonly items$ = combineLatest([
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      startWith(null),
    ),
    this.recipeService.recipes$,
    this.ingredientService.ingredients$,
  ]).pipe(
    map(() => this.itemsForUrl(this.router.url)),
  );

  private itemsForUrl(url: string): BreadcrumbItem[] {
    if (this.router.routerState.snapshot.root.firstChild?.routeConfig?.path === '**') return [{ label: 'Página no encontrada', url: null }];
    const route = this.router.parseUrl(url);
    const segments = (route.root.children['primary']?.segments ?? []).map((segment) => segment.path);
    const fromPlanner = route.queryParams['fromPlanner'];
    const start = route.queryParams['plannerStart'];
    const plannerStart = typeof start === 'string' && Number.isFinite(dateNumber(start)) ? start : undefined;
    const isPlannerOrigin = fromPlanner === 'today' || fromPlanner === 'day' || fromPlanner === 'week';
    const isInventoryOrigin = route.queryParams['fromInventory'] === 'true';
    const plannerQuery = isInventoryOrigin ? { fromInventory: 'true' } : isPlannerOrigin ? { fromPlanner, plannerStart } : {};
    const recipeParents: BreadcrumbItem[] = isInventoryOrigin
      ? [{ label: 'Inventario', url: '/inventory' }]
      : isPlannerOrigin
      ? [
        { label: 'Planificación', url: '/planner' },
        ...(fromPlanner === 'week' ? [{ label: 'Semanal', url: this.router.createUrlTree(['/planner/week'], { queryParams: { start: plannerStart } }) }] : []),
        ...(fromPlanner === 'day' ? [{ label: 'Día', url: '/planner/day' }] : []),
      ]
      : [{ label: 'Recetas', url: '/recipes' }];

    if (segments[0] === 'login') return [{ label: 'Acceso', url: null }];
    if (segments[0] === 'shopping') return [{ label: 'Compra', url: null }];
    if (segments[0] === 'inventory') return [{ label: 'Inventario', url: null }];
    if (segments[0] === 'planner') {
      if (segments[1] === 'week' || segments[1] === 'day') {
        return [{ label: 'Planificación', url: '/planner' }, { label: segments[1] === 'day' ? 'Día' : 'Semanal', url: null }];
      }
      return [{ label: 'Planificación', url: null }];
    }

    if (segments[0] === 'recipes' && segments[1]) {
      const recipe = this.recipeService.getById(segments[1]);
      return [
        ...recipeParents,
        { label: recipe?.name ?? 'Receta', url: null },
      ];
    }

    if (segments[0] === 'ingredients' && segments[1]) {
      const ingredient = this.ingredientService.getById(segments[1]);
      const fromRecipeId = route.queryParams['fromRecipeId'];
      if (typeof fromRecipeId === 'string') {
        const parentRecipe = this.recipeService.getById(fromRecipeId);
        if (parentRecipe && ingredient) {
          return [
            ...recipeParents,
            { label: parentRecipe.name, url: this.router.createUrlTree(['/recipes', parentRecipe.id], { queryParams: plannerQuery }) },
            { label: ingredient.name, url: null },
          ];
        }
      }
      return [
        { label: isInventoryOrigin ? 'Inventario' : 'Ingredientes', url: isInventoryOrigin ? '/inventory' : '/ingredients' },
        { label: ingredient?.name ?? 'Ingrediente', url: null },
      ];
    }

    if (segments[0] === 'ingredients') {
      return [{ label: 'Ingredientes', url: null }];
    }

    return [{ label: 'Recetas', url: null }];
  }
}

