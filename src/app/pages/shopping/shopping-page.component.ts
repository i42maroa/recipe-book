import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, HostListener, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
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
import { shoppingDefaultQuantity, shoppingPurchaseReady, shoppingQuantityLabel } from '../../utils/shopping-quantities.utils';
import { RecipeIngredientAmount } from '../../models/recipe.model';
import { InventoryService } from '../../services/inventory.service';
import { ShoppingAmountDialogComponent } from '../../components/shopping-amount-dialog/shopping-amount-dialog.component';
import { localDate } from '../../utils/scheduled-meal.utils';
import { lockDialogScroll } from '../../utils/dialog-scroll.utils';
import { ingredientAmountLabel } from '../../utils/ingredient-measures.utils';

@Component({
  selector: 'app-shopping-page', standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IngredientFilterComponent, ShoppingPlanPickerComponent, ShoppingAmountDialogComponent, IconComponent, SkeletonComponent],
  templateUrl: './shopping-page.component.html',
  styleUrl: './shopping-page.component.css',
})
export class ShoppingPageComponent {
  readonly list = inject(ShoppingListService);
  private readonly auth = inject(AuthService);
  readonly ingredients = inject(IngredientService);
  readonly inventory = inject(InventoryService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly owner = this.auth.user()?.id;
  private readonly document = inject(DOCUMENT);
  private readonly addDialog = viewChild<ElementRef<HTMLDialogElement>>('addDialog');
  private readonly ingredientPicker = viewChild(IngredientFilterComponent);
  readonly planningPicker = viewChild<ShoppingPlanPickerComponent>('planningPicker');
  private readonly purchaseDialog = viewChild<ElementRef<HTMLDialogElement>>('purchaseDialog');
  readonly purchaseOpen = signal(false);
  readonly purchaseBusy = signal(false);
  readonly destination = new FormControl('', { nonNullable: true });
  readonly today = localDate();
  readonly editingQuantity = signal<ShoppingItem | null>(null);
  readonly quantityLabel = shoppingQuantityLabel;
  readonly amountLabel = (amount: RecipeIngredientAmount): string => ingredientAmountLabel(amount, true) ?? '';
  readonly unitLabel = (value: number | null): string => `×${new Intl.NumberFormat('es', { maximumSignificantDigits: 15 }).format(value ?? 0)}`;
  readonly displayAmounts = (item: ShoppingItem): RecipeIngredientAmount[] => shoppingDefaultQuantity(item).amounts ?? [];
  readonly purchaseReady = computed(() => shoppingPurchaseReady(this.list.items()));
  readonly locked = computed(() => this.list.loading() || this.list.saving() || this.list.purchasePending() || this.purchaseBusy());
  readonly creatingIngredient = computed(() => this.ingredientPicker()?.addingIngredient() ?? false);
  readonly addOpen = signal(false);
  readonly addMode = signal<'manual' | 'planning'>('manual');
  readonly sharing = signal(false);
  readonly manualShareText = signal('');
  readonly selectedIds = computed(() => this.list.items().map(item => item.id));
  readonly groups = computed(() => shoppingGroups(this.list.items()));

  constructor() {
    effect(() => {
      if (!this.auth.canEdit() || this.auth.user()?.id !== this.owner) {
        this.editingQuantity.set(null); this.purchaseOpen.set(false); this.purchaseDialog()?.nativeElement.close();
        this.addOpen.set(false); this.addDialog()?.nativeElement.close();
        this.addMode.set('manual'); this.manualShareText.set(''); void this.router.navigate(['/login']);
      }
    });
    effect(onCleanup => {
      if (!this.addOpen() && !this.purchaseOpen()) return;
      onCleanup(lockDialogScroll(this.document));
    });
    void this.list.load().catch(() => undefined);
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void { if (this.list.dirty() || this.list.saving() || this.purchaseBusy() || this.creatingIngredient()) event.preventDefault(); }
  canLeave(): boolean { return this.auth.user()?.id !== this.owner || !this.auth.canEdit() || (!this.list.saving() && !this.purchaseBusy() && !this.creatingIngredient()); }

  openAdd(): void {
    const dialog = this.addDialog()?.nativeElement;
    if (!dialog || dialog.open || !this.list.ready() || this.locked() || this.creatingIngredient()) return;
    this.addOpen.set(true); dialog.showModal();
  }

  closeAdd(event?: Event): void {
    event?.preventDefault();
    if (this.creatingIngredient()) return;
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

  addPlanning(items: ShoppingItem[]): void {
    if (!this.addOpen() || this.addMode() !== 'planning' || !this.auth.canEdit() || this.auth.user()?.id !== this.owner || this.locked() || this.creatingIngredient()) return;
    try {
      if (!this.list.addPlanning(items)) return;
      this.manualShareText.set(''); this.closeAdd(); this.addMode.set('manual');
      this.notifications.success('Ingredientes del planning añadidos. Guarda la lista para conservar los cambios.');
    } catch (error) { this.notifications.error(error instanceof Error ? error.message : 'No se pudieron añadir los ingredientes del planning.'); }
  }

  async save(): Promise<void> {
    if (this.creatingIngredient()) return;
    if (await this.list.save()) this.notifications.success('Lista de la compra guardada.');
  }

  async editQuantity(item: ShoppingItem): Promise<void> {
    if (this.locked()) return;
    await this.ingredients.ensureLoaded().catch(() => undefined);
    if (this.auth.user()?.id === this.owner && this.auth.canEdit() && !this.locked()) this.editingQuantity.set(item);
  }
  hasUnits(item: ShoppingItem): boolean { return this.displayAmounts(item).some(amount => amount.kind === 'specific' && amount.unit === 'pieza'); }
  incrementUnit(item: ShoppingItem, index: number): void {
    if (this.locked() || this.creatingIngredient()) return;
    try { this.list.incrementUnit(item.id, index); this.manualShareText.set(''); }
    catch (error) { this.notifications.error(error instanceof Error ? error.message : 'No se pudo incrementar la cantidad.'); }
  }
  applyQuantity(amounts: (RecipeIngredientAmount | null)[]): void {
    const item = this.editingQuantity(); if (!item) return;
    try { this.list.setAmounts(item.id, amounts); this.editingQuantity.set(null); this.manualShareText.set(''); }
    catch (error) { this.notifications.error(error instanceof Error ? error.message : 'Revisa las cantidades.'); }
  }
  async openPurchase(): Promise<void> {
    if (!this.purchaseReady() || this.list.saving() || this.list.loading() || this.purchaseBusy()) return;
    this.purchaseBusy.set(true);
    try {
      if (this.list.purchasePending()) {
        this.destination.setValue(this.list.pendingPurchasePlaceId());
        this.purchaseOpen.set(true); this.purchaseDialog()?.nativeElement.showModal(); return;
      }
      if (this.inventory.dirty() || this.inventory.saving()) throw new Error('Guarda o revisa los cambios pendientes del inventario antes de registrar la compra.');
      await this.inventory.load(true);
      if (this.auth.user()?.id !== this.owner || !this.auth.canEdit()) return;
      if (!this.inventory.ready() || this.inventory.error()) throw new Error(this.inventory.error() || 'No se pudo cargar el inventario.');
      this.destination.setValue(this.list.pendingPurchasePlaceId() || this.inventory.selected()?.id || '');
      this.purchaseOpen.set(true); this.purchaseDialog()?.nativeElement.showModal();
    } catch (error) { if (this.auth.user()?.id === this.owner) this.notifications.error(error instanceof Error ? error.message : 'No se pudo abrir la compra.'); }
    finally { this.purchaseBusy.set(false); }
  }
  closePurchase(event?: Event): void {
    event?.preventDefault(); if (this.purchaseBusy() || this.list.saving()) return;
    this.purchaseOpen.set(false); this.purchaseDialog()?.nativeElement.close();
  }
  async confirmPurchase(): Promise<void> {
    if (!this.destination.value || this.purchaseBusy()) return;
    this.purchaseBusy.set(true);
    try {
      if (await this.list.purchase(this.destination.value)) {
        if (this.auth.user()?.id !== this.owner || !this.auth.canEdit()) return;
        this.manualShareText.set(''); this.purchaseOpen.set(false); this.purchaseDialog()?.nativeElement.close();
        this.notifications.success('Compra añadida a la alacena. La lista se ha vaciado.');
        if (!this.inventory.dirty() && !this.inventory.saving()) await this.inventory.load(true);
      }
    } finally { this.purchaseBusy.set(false); }
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
