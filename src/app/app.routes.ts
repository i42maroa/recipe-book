import { Routes } from '@angular/router';
import { RecipesPageComponent } from './pages/recipes/recipes-page.component';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login-page.component').then((m) => m.LoginPageComponent) },
  { path: '', pathMatch: 'full', redirectTo: 'recipes' },
  { path: 'recipes/:id', loadComponent: () => import('./pages/recipe-detail/recipe-detail-page.component').then((m) => m.RecipeDetailPageComponent) },
  { path: 'ingredients/:id', loadComponent: () => import('./pages/ingredient-detail/ingredient-detail-page.component').then((m) => m.IngredientDetailPageComponent) },
  { path: 'recipes', pathMatch: 'full', component: RecipesPageComponent },
  { path: 'ingredients', loadComponent: () => import('./pages/ingredients/ingredients-page.component').then((m) => m.IngredientsPageComponent) },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found-page.component').then((m) => m.NotFoundPageComponent) },
];

