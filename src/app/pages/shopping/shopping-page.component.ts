import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, HostListener, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ShoppingPlanPickerComponent } from '../../components/shopping-plan-picker/shopping-plan-picker.component';
import { IngredientFilterComponent } from '../../components/shared/filters/ingredient-filter/ingredient-filter.component';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { SkeletonComponent } from '../../components/shared/skeleton/skeleton.component';
import { ShoppingItem } from '../../models/shopping-list.model';
import { AuthService } from '../../services/auth.service';
import { IngredientService } from '../../services/ingredient.service';
import { NotificationService } from '../../services/notification.service';
import { ShoppingListService } from '../../services/shopping-list.service';
import { shoppingGroups, shoppingShareText } from '../../utils/shopping-list.utils';

@Component({
  selector: 'app-shopping-page', standalone: true,
  imports: [IngredientFilterComponent, ShoppingPlanPickerComponent, IconComponent, SkeletonComponent],
  templateUrl: './shopping-page.component.html',
  styleUrl: './shopping-page.component.css',
})
export class ShoppingPageComponent {
  readonly list = inject(ShoppingListService);
  private readonly auth = inject(AuthService);
  private readonly ingredients = inject(IngredientService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly owner = this.auth.user()?.id;
  private readonly document = inject(DOCUMENT);
  private readonly addDialog = viewChild<ElementRef<HTMLDialogElement>>('addDialog');
  private readonly replacementDialog = viewChild<ElementRef<HTMLDialogElement>>('replacementDialog');
  private readonly manualTab = viewChild<ElementRef<HTMLButtonElement>>('manualTab');
  private readonly ingredientPicker = viewChild(IngredientFilterComponent);
  readonly creatingIngredient = computed(() => this.ingredientPicker()?.addingIngredient() ?? false);
  readonly addOpen = signal(false);
  readonly addMode = signal<'manual' | 'planning'>('manual');
  readonly pendingReplacement = signal<ShoppingItem[] | null>(null);
  readonly sharing = signal(false);
  readonly manualShareText = signal('');
  readonly selectedIds = computed(() => this.list.items().map(item => item.id));
  readonly groups = computed(() => shoppingGroups(this.list.items()));

  constructor() {
    effect(() => {
      if (!this.auth.canEdit() || this.auth.user()?.id !== this.owner) {
        this.cancelReplacement();
        this.addOpen.set(false); this.addDialog()?.nativeElement.close();
        this.addMode.set('manual'); this.manualShareText.set(''); void this.router.navigate(['/login']);
      }
    });
    effect(onCleanup => {
      if (!this.addOpen() && !this.pendingReplacement()) return;
      const previousOverflow = this.document.body.style.overflow;
      this.document.body.style.overflow = 'hidden';
      onCleanup(() => { this.document.body.style.overflow = previousOverflow; });
    });
    void this.list.load().catch(() => undefined);
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void { if (this.list.dirty() || this.list.saving() || this.creatingIngredient()) event.preventDefault(); }

  openAdd(): void {
    const dialog = this.addDialog()?.nativeElement;
    if (!dialog || dialog.open || !this.list.ready() || this.list.loading() || this.list.saving() || this.creatingIngredient()) return;
    this.addOpen.set(true); dialog.showModal();
  }

  closeAdd(event?: Event): void {
    event?.preventDefault();
    if (this.creatingIngredient() || this.pendingReplacement()) return;
    this.addOpen.set(false); this.addDialog()?.nativeElement.close();
  }

  add(ids: string[]): void {
    const additions = ids.flatMap(id => {
      const ingredient = this.ingredients.getById(id);
      return ingredient ? [ingredient] : [];
    });
    this.list.add(additions); this.manualShareText.set('');
  }

  remove(id: string): void { this.list.remove(id); this.manualShareText.set(''); }

  clear(): void { this.list.clear(); this.manualShareText.set(''); }

  increment(id: string): void { this.list.increment(id); this.manualShareText.set(''); }

  tabKeydown(event: KeyboardEvent): void {
    if (this.creatingIngredient()) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const mode = event.key === 'Home' ? 'manual' : event.key === 'End' ? 'planning'
      : this.addMode() === 'manual' ? 'planning' : 'manual';
    this.addMode.set(mode);
    const tab = event.currentTarget as HTMLElement;
    tab.parentElement?.querySelector<HTMLButtonElement>(`#shopping-tab-${mode}`)?.focus();
  }

  requestReplacement(items: ShoppingItem[]): void {
    const dialog = this.replacementDialog()?.nativeElement;
    if (!dialog || dialog.open || !items.length || !this.list.ready() || this.list.loading() || this.list.saving() || this.creatingIngredient()) return;
    this.pendingReplacement.set(structuredClone(items));
    dialog.showModal();
  }

  cancelReplacement(): void {
    this.pendingReplacement.set(null);
    this.replacementDialog()?.nativeElement.close();
  }

  confirmReplacement(): void {
    const items = this.pendingReplacement();
    if (!items || !this.auth.canEdit() || this.auth.user()?.id !== this.owner || !this.list.ready() || this.list.loading() || this.list.saving() || this.creatingIngredient()) return;
    this.list.replace(items); this.cancelReplacement(); this.manualShareText.set('');
    this.addMode.set('manual'); this.manualTab()?.nativeElement.focus();
    this.notifications.success('Ingredientes del planning añadidos. Guarda la lista para conservar los cambios.');
  }

  async save(): Promise<void> {
    if (this.creatingIngredient()) return;
    if (await this.list.save()) this.notifications.success('Lista de la compra guardada.');
  }

  reload(): void {
    if (this.creatingIngredient()) return;
    if (this.list.dirty() && !window.confirm('¿Quieres cargar la lista guardada y descartar los cambios de este borrador?')) return;
    void this.list.load(true).catch(() => undefined);
  }

  async share(): Promise<void> {
    if (this.sharing() || !this.list.items().length || this.list.loading()) return;
    const text = shoppingShareText(this.list.items());
    this.sharing.set(true); this.manualShareText.set('');
    try {
      if (navigator.share) {
        try { await navigator.share({ title: 'Lista de la compra', text }); return; }
        catch (error) { if (error instanceof Error && error.name === 'AbortError') return; }
      }
      if (!this.auth.canEdit() || this.auth.user()?.id !== this.owner) return;
      try { await navigator.clipboard.writeText(text); this.notifications.success('Lista de la compra copiada.'); }
      catch { if (this.auth.canEdit() && this.auth.user()?.id === this.owner) this.manualShareText.set(text); }
    } finally { this.sharing.set(false); }
  }
}
