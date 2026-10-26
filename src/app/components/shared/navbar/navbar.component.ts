import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { combineLatest, filter, map, startWith } from 'rxjs';
import { Ingredient, Recipe } from '../../../models/recipe.model';
import { AuthService } from '../../../services/auth.service';
import { FormService } from '../../../services/form.service';
import { IngredientService } from '../../../services/ingredient.service';
import { NotificationService } from '../../../services/notification.service';
import { RecipeService } from '../../../services/recipe.service';
import { RecipeDetailActionsService } from '../../../services/recipe-detail-actions.service';
import { FreezerService } from '../../../services/freezer.service';
import { FreezerNavigationAction, FreezerNavigationService } from '../../../services/freezer-navigation.service';
import { IconComponent } from '../icon/icon.component';
import { UserSessionComponent } from '../user-session/user-session.component';

type Detail = { kind: 'recipe'; item: Recipe } | { kind: 'ingredient'; item: Ingredient };

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent, UserSessionComponent],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css',
})
export class NavbarComponent {
  readonly auth = inject(AuthService);
  readonly recipeActions = inject(RecipeDetailActionsService);
  readonly freezerInventory = inject(FreezerService);
  readonly freezerNavigation = inject(FreezerNavigationService);
  private readonly router = inject(Router);
  private readonly recipes = inject(RecipeService);
  private readonly ingredients = inject(IngredientService);
  private readonly forms = inject(FormService);
  private readonly notifications = inject(NotificationService);
  private readonly toggle = viewChild<ElementRef<HTMLButtonElement>>('menuToggle');
  private readonly sidebar = viewChild<ElementRef<HTMLElement>>('sidebar');
  readonly menuOpen = signal(false);
  readonly deleting = signal(false);
  readonly isFreezerPage = toSignal(this.router.events.pipe(
    filter(event => event instanceof NavigationEnd), startWith(null),
    map(() => this.router.parseUrl(this.router.url).root.children['primary']?.segments.map(segment => segment.path).join('/') === 'freezer'),
  ), { initialValue: false });
  readonly detail = toSignal(combineLatest([
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd), startWith(null)),
    this.recipes.recipes$,
    this.ingredients.ingredients$,
  ]).pipe(map(([, recipes, ingredients]): Detail | null => {
    const route = this.router.parseUrl(this.router.url);
    const segments = route.root.children['primary']?.segments ?? [];
    if (segments.length !== 2) return null;
    const [section, id] = segments.map((segment) => segment.path);
    if (section === 'recipes') {
      const item = recipes.find((recipe) => recipe.id === id);
      return item ? { kind: 'recipe', item } : null;
    }
    if (section === 'ingredients') {
      const item = ingredients.find((ingredient) => ingredient.id === id);
      return item ? { kind: 'ingredient', item } : null;
    }
    return null;
  })), { initialValue: null });

  constructor() {
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd), takeUntilDestroyed(),
    ).subscribe(() => this.closeMenu());
  }

  closeMenu(restoreFocus = false): void {
    this.menuOpen.set(false);
    if (restoreFocus) this.toggle()?.nativeElement.focus();
  }

  containFocus(event: Event): void {
    if (!(event instanceof KeyboardEvent) || !this.menuOpen() || !window.matchMedia('(max-width: 1120px)').matches) return;
    const controls = this.sidebar()?.nativeElement.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled])');
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  edit(detail: Detail): void {
    this.closeMenu(true);
    this.forms.openForm(detail.kind, detail.item);
  }

  rate(recipe: Recipe): void {
    if (!this.auth.canEdit() || this.deleting() || this.recipeActions.busy() || this.recipeActions.recipeId() !== recipe.id) return;
    this.closeMenu(true);
    this.recipeActions.requestRating(recipe.id);
  }

  freezerAction(action: FreezerNavigationAction): void {
    if (!this.auth.canEdit() || !this.isFreezerPage() || this.freezerNavigation.blocked()) return;
    this.closeMenu(true);
    this.freezerNavigation.request(action);
  }

  async remove(detail: Detail): Promise<void> {
    if (!this.auth.canEdit() || this.deleting()) return;
    const label = detail.kind === 'recipe' ? 'la receta' : 'el ingrediente';
    if (!window.confirm(`¿Quieres eliminar ${label} «${detail.item.name}»?`)) return;
    this.deleting.set(true);
    try {
      if (detail.kind === 'recipe') {
        await this.recipes.remove(detail.item.id);
        this.notifications.success('Receta eliminada.');
      } else if (!await this.ingredients.remove(detail.item.id)) return;
      this.closeMenu(true);
      await this.router.navigate([detail.kind === 'recipe' ? '/recipes' : '/ingredients']);
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'No se pudo eliminar el elemento.');
    } finally {
      this.deleting.set(false);
    }
  }
}


