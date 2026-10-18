import { Routes } from '@angular/router';
import { IngredientsPageComponent } from './pages/ingredients/ingredients-page.component';
import { IngredientDetailPageComponent } from './pages/ingredient-detail/ingredient-detail-page.component';
import { RecipeDetailPageComponent } from './pages/recipe-detail/recipe-detail-page.component';
import { RecipesPageComponent } from './pages/recipes/recipes-page.component';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login-page.component').then((m) => m.LoginPageComponent) },
  { path: '', pathMatch: 'full', redirectTo: 'recipes' },
  { path: 'recipes/:id', component: RecipeDetailPageComponent },
  { path: 'ingredients/:id', component: IngredientDetailPageComponent },
  { path: 'recipes', pathMatch: 'full', component: RecipesPageComponent },
  { path: 'ingredients', component: IngredientsPageComponent },
  { path: '**', redirectTo: 'recipes' },
];

