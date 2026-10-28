import { Routes } from '@angular/router';
import { RecipesPageComponent } from './pages/recipes/recipes-page.component';
import { editorGuard } from './guards/editor.guard';
import type { PlannerEditorPageComponent } from './pages/planner/planner-editor-page.component';
import type { InventoryPageComponent } from './pages/inventory/inventory-page.component';
import type { ShoppingPageComponent } from './pages/shopping/shopping-page.component';

export const routes: Routes = [
  { path: 'freezer', pathMatch: 'full', redirectTo: 'inventory' },
  { path: 'inventory', canActivate: [editorGuard], canDeactivate: [(component: InventoryPageComponent) => component.canLeave()], loadComponent: () => import('./pages/inventory/inventory-page.component').then(m => m.InventoryPageComponent) },
  { path: 'shopping', canActivate: [editorGuard], canDeactivate: [(component: ShoppingPageComponent) => component.canLeave()], loadComponent: () => import('./pages/shopping/shopping-page.component').then(m => m.ShoppingPageComponent) },
  { path: 'planner/week', canActivate: [editorGuard], canDeactivate: [(component: PlannerEditorPageComponent) => component.canLeave()], loadComponent: () => import('./pages/planner/planner-editor-page.component').then((m) => m.PlannerEditorPageComponent) },
  { path: 'planner/day', data: { todayOnly: true }, canActivate: [editorGuard], canDeactivate: [(component: PlannerEditorPageComponent) => component.canLeave()], loadComponent: () => import('./pages/planner/planner-editor-page.component').then((m) => m.PlannerEditorPageComponent) },
  { path: 'planner', pathMatch: 'full', canActivate: [editorGuard], loadComponent: () => import('./pages/planner/planner-page.component').then((m) => m.PlannerPageComponent) },
  { path: 'login', loadComponent: () => import('./pages/login/login-page.component').then((m) => m.LoginPageComponent) },
  { path: '', pathMatch: 'full', redirectTo: 'recipes' },
  { path: 'recipes/:id', loadComponent: () => import('./pages/recipe-detail/recipe-detail-page.component').then((m) => m.RecipeDetailPageComponent) },
  { path: 'ingredients/:id', loadComponent: () => import('./pages/ingredient-detail/ingredient-detail-page.component').then((m) => m.IngredientDetailPageComponent) },
  { path: 'recipes', pathMatch: 'full', component: RecipesPageComponent },
  { path: 'ingredients', loadComponent: () => import('./pages/ingredients/ingredients-page.component').then((m) => m.IngredientsPageComponent) },
  { path: '**', loadComponent: () => import('./pages/not-found/not-found-page.component').then((m) => m.NotFoundPageComponent) },
];

