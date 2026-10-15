import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { combineLatest, filter, map, startWith } from 'rxjs';
import { RecipeService } from '../../../services/recipe.service';
import { IngredientService } from '../../../services/ingredient.service';

interface BreadcrumbItem {
  label: string;
  url: string | null;
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
    const route = this.router.parseUrl(url);
    const segments = (route.root.children['primary']?.segments ?? []).map((segment) => segment.path);

    if (segments[0] === 'recipes' && segments[1]) {
      const recipe = this.recipeService.getById(segments[1]);
      return [
        { label: 'Recetas', url: '/recipes' },
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
            { label: 'Recetas', url: '/recipes' },
            { label: parentRecipe.name, url: `/recipes/${parentRecipe.id}` },
            { label: ingredient.name, url: null },
          ];
        }
      }
      return [
        { label: 'Ingredientes', url: '/ingredients' },
        { label: ingredient?.name ?? 'Ingrediente', url: null },
      ];
    }

    if (segments[0] === 'ingredients') {
      return [{ label: 'Ingredientes', url: null }];
    }

    return [{ label: 'Recetas', url: null }];
  }
}

