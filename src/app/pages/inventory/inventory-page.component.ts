import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, Injector, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { skip } from 'rxjs';
import { InventoryEntryDialogComponent } from '../../components/inventory-entry-dialog/inventory-entry-dialog.component';
import { InventoryItemDialogComponent } from '../../components/inventory-item-dialog/inventory-item-dialog.component';
import { InventoryPlaceDialogComponent } from '../../components/inventory-place-dialog/inventory-place-dialog.component';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { SkeletonComponent } from '../../components/shared/skeleton/skeleton.component';
import { SearchFilterComponent } from '../../components/shared/filters/search-filter/search-filter.component';
import { SelectFilterComponent } from '../../components/shared/filters/select-filter/select-filter.component';
import { SelectFilterOption } from '../../components/shared/filters/select-filter-options';
import { InventoryItem, InventorySpace } from '../../models/inventory.model';
import { AuthService } from '../../services/auth.service';
import { InventoryService } from '../../services/inventory.service';
import { InventoryPlanningService } from '../../services/inventory-planning.service';
import { InventoryIngredientPlanningService } from '../../services/inventory-ingredient-planning.service';
import { InventoryNavigationService } from '../../services/inventory-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { InventorySort, sortInventoryItems } from '../../utils/inventory.utils';
import { categorizeInventoryGroups, groupInventoryItems, inventoryGroupTotal, InventoryItemGroup } from '../../utils/inventory-groups.utils';
import { lockDialogScroll } from '../../utils/dialog-scroll.utils';
import { RecipeService } from '../../services/recipe.service';
import { normalizeSearch } from '../../utils/search.utils';

type InventoryAction = { kind: 'create' } | { kind: 'rename'; placeId: string };

@Component({
  selector: 'app-inventory-page', standalone: true,
  imports: [ReactiveFormsModule, InventoryEntryDialogComponent, InventoryItemDialogComponent, InventoryPlaceDialogComponent, IconComponent, SkeletonComponent, SearchFilterComponent, SelectFilterComponent],
  templateUrl: './inventory-page.component.html',
  styleUrl: './inventory-page.component.css',
})
export class InventoryPageComponent {
  readonly inventory = inject(InventoryService);
  readonly planning = inject(InventoryPlanningService);
  readonly ingredientPlanning = inject(InventoryIngredientPlanningService);
  private readonly navigation = inject(InventoryNavigationService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly owner = this.auth.user()?.id;
  private readonly actionDialog = viewChild<ElementRef<HTMLDialogElement>>('actionDialog');
  private readonly entryDialog = viewChild(InventoryEntryDialogComponent);
  readonly selected = this.inventory.selected;
  readonly search = new FormControl('', { nonNullable: true });
  readonly sort = new FormControl<InventorySort>('oldest', { nonNullable: true });
  readonly planningFilter = new FormControl<'all' | 'planned' | 'unplanned'>('all', { nonNullable: true });
  readonly planningFilterValue = toSignal(this.planningFilter.valueChanges, { initialValue: this.planningFilter.value });
  readonly planningReady = computed(() => this.ingredientPlanning.ready() && !this.ingredientPlanning.loading() && !this.ingredientPlanning.error()
    && !this.planning.loading() && !this.planning.error());
  private readonly searchValue = toSignal(this.search.valueChanges, { initialValue: this.search.value });
  private readonly sortValue = toSignal(this.sort.valueChanges, { initialValue: this.sort.value });
  readonly sortOptions: SelectFilterOption[] = [
    { value: 'oldest', label: 'Más antiguos' }, { value: 'newest', label: 'Más recientes' },
    { value: 'name', label: 'Nombre A–Z' }, { value: 'name-desc', label: 'Nombre Z–A' },
  ];
  readonly planningOptions: SelectFilterOption[] = [
    { value: 'all', label: 'Todos' }, { value: 'planned', label: 'Planificados' }, { value: 'unplanned', label: 'No planificados' },
  ];
  readonly spaces: { value: InventorySpace; label: string }[] = [{ value: 'pantry', label: 'Alacena' }, { value: 'freezer', label: 'Congelador' }];
  readonly spaceLabel = computed(() => this.inventory.selectedSpace() === 'pantry' ? 'Alacena' : 'Congelador');
  readonly spaceItems = computed(() => (this.selected()?.items ?? []).filter(item => item.space === this.inventory.selectedSpace()));
  private readonly allGroups = computed(() => groupInventoryItems(sortInventoryItems(this.spaceItems(), this.sortValue())));
  readonly groups = computed(() => {
    const query = normalizeSearch(this.searchValue());
    const planning = this.planningFilterValue();
    if (planning !== 'all' && !this.planningReady()) return [];
    return this.allGroups()
      .filter(group => group.items.some(item => normalizeSearch(item.name).includes(query)))
      .filter(group => planning === 'all' || this.isPlanned(group) === (planning === 'planned'));
  });
  readonly categories = computed(() => categorizeInventoryGroups(this.groups()));
  private readonly detailSelection = signal<InventoryItemGroup | null>(null);
  readonly detailTrigger = signal<HTMLElement | null>(null);
  readonly entryTrigger = signal<HTMLElement | null>(null);
  readonly placesOpen = signal(false);
  readonly placesTrigger = signal<HTMLElement | null>(null);
  private actionTrigger: HTMLElement | null = null;
  readonly detailGroup = computed(() => {
    const selection = this.detailSelection();
    if (!selection) return null;
    const ids = new Set(selection.items.map(item => item.id));
    return this.allGroups().find(group => group.id === selection.id)
      ?? this.allGroups().find(group => group.items.some(item => ids.has(item.id))) ?? { ...selection, items: [] };
  });
  readonly entryOpen = signal(false);
  readonly editingItem = signal<InventoryItem | null>(null);
  readonly action = signal<InventoryAction | null>(null);
  readonly actionError = signal('');
  readonly placeName = new FormControl('', { nonNullable: true });
  readonly blocked = computed(() => !this.inventory.ready() || this.inventory.loading() || !!this.inventory.error());
  readonly modifying = computed(() => this.blocked() || this.entryOpen() || !!this.action());
  readonly busy = computed(() => this.modifying() || !!this.detailGroup() || this.placesOpen());
  readonly actionTitle = computed(() => this.action()?.kind === 'create' ? 'Nuevo lugar' : 'Renombrar lugar');
  readonly groupTotal = inventoryGroupTotal;
  isPlanned(group: InventoryItemGroup): boolean {
    return (group.item.ingredientId ? this.ingredientPlanning.isPlanned(group.item.ingredientId) : false)
      || this.planning.isPlanned(this.selected()?.id ?? '', group.items.map(item => item.id));
  }

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => { this.navigation.blocked.set(this.busy()); });
    destroyRef.onDestroy(() => this.navigation.blocked.set(true));
    this.navigation.actions$.pipe(takeUntilDestroyed()).subscribe(() => this.openPlaces());
    effect(() => {
      if (!this.auth.canEdit() || this.auth.user()?.id !== this.owner) {
        this.entryOpen.set(false); this.detailSelection.set(null); this.placesOpen.set(false); this.closeAction(); void this.router.navigate(['/login']);
      }
    });
    effect(onCleanup => {
      if (!this.action()) return;
      onCleanup(lockDialogScroll(this.document));
    });
    void this.inventory.load().catch(() => undefined);
    void this.planning.load(true);
    void this.ingredientPlanning.load(true);
    inject(RecipeService).changes$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => { void this.inventory.refreshRecipeLinks(true); });
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.inventory.dirty() || this.inventory.saving() || this.entryDialog()?.creating() || this.entryDialog()?.hasChanges() || this.action()) event.preventDefault();
  }

  canLeave(): boolean {
    if (this.inventory.saving() || this.entryDialog()?.creating()) return false;
    if (this.entryDialog()?.hasChanges()) return window.confirm('¿Quieres salir y descartar los cambios del formulario abierto? El borrador del listado se conserva.');
    if (this.action()) return window.confirm('¿Quieres salir y cerrar el formulario sin aplicar sus cambios?');
    return true;
  }

  choose(id: string): void { this.inventory.select(id); this.search.setValue(''); }

  chooseSpace(space: InventorySpace): void { this.inventory.select(this.selected()?.id ?? '', space); this.search.setValue(''); }

  spaceKey(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const space = event.key === 'Home' ? 'pantry' : event.key === 'End' ? 'freezer' : this.inventory.selectedSpace() === 'pantry' ? 'freezer' : 'pantry';
    this.chooseSpace(space); this.document.getElementById(`inventory-tab-${space}`)?.focus();
  }

  openPlaces(): void {
    if (this.busy()) return;
    this.placesTrigger.set(this.document.activeElement as HTMLElement | null);
    this.placesOpen.set(true);
  }

  closePlaces(): void {
    if (this.entryOpen() || this.action()) return;
    const target = this.placesTrigger();
    this.placesOpen.set(false);
    if (target) afterNextRender(() => {
      if (target.isConnected && !target.matches(':disabled')) target.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  renamePlace(): void {
    const place = this.selected();
    if (place) this.openAction({ kind: 'rename', placeId: place.id });
  }

  openDetails(group: InventoryItemGroup): void {
    if (this.busy()) return;
    this.detailTrigger.set(this.document.activeElement as HTMLElement | null);
    this.detailSelection.set(group);
  }

  closeDetails(): void {
    if (this.entryOpen() || this.action()) return;
    const previous = this.detailTrigger();
    this.detailSelection.set(null);
    afterNextRender(() => {
      const target = previous?.isConnected && !previous.matches(':disabled') ? previous
        : this.document.getElementById('inventory-tab-' + this.inventory.selectedSpace());
      target?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  openEntries(item: InventoryItem | null = null): void {
    if (this.modifying() || this.placesOpen() || (!item && this.detailGroup()) || !this.selected()) return;
    this.entryTrigger.set(this.document.activeElement as HTMLElement | null);
    this.editingItem.set(item); this.entryOpen.set(true);
  }

  confirmEntries(items: InventoryItem[]): void {
    const place = this.selected();
    if (!place || this.blocked()) return;
    try {
      const applied = this.editingItem() ? this.inventory.updateItem(place.id, items[0]) : this.inventory.addItems(place.id, items);
      if (applied) {
        if (this.editingItem() && this.detailSelection()) {
          const group = this.allGroups().find(group => group.items.some(item => item.id === items[0].id));
          if (group) this.detailSelection.set(group);
        }
        this.entryOpen.set(false);
      }
    } catch (error) { this.notifications.error(error instanceof Error ? error.message : 'No se pudieron añadir las entradas.'); }
  }

  openAction(action: InventoryAction): void {
    if (this.modifying() || this.detailGroup()) return;
    this.actionTrigger = this.document.activeElement as HTMLElement | null;
    this.placeName.setValue(action.kind === 'rename' ? this.selected()?.name ?? '' : '');
    this.actionError.set(''); this.action.set(action);
    this.actionDialog()?.nativeElement.showModal();
  }

  closeAction(): void {
    const target = this.actionTrigger;
    this.actionTrigger = null;
    this.action.set(null); this.actionDialog()?.nativeElement.close();
    if (target) afterNextRender(() => {
      if (target.isConnected && !target.matches(':disabled')) target.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  applyAction(event: Event): void {
    event.preventDefault();
    const action = this.action();
    if (!action || this.blocked()) return;
    try {
      const name = this.placeName.value.trim();
      if (!name) { this.actionError.set('Escribe un nombre para el lugar.'); return; }
      if (action.kind === 'rename') this.inventory.rename(action.placeId, name);
      else {
        const id = this.inventory.create(name);
        if (id) this.choose(id);
      }
      this.closeAction();
    } catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Revisa los datos.'); }
  }

  removePlace(): void {
    const place = this.selected();
    if (!place || this.modifying() || this.detailGroup() || place.items.length) return;
    if (window.confirm(`¿Quieres eliminar el lugar «${place.name}»?`)) { this.inventory.removePlace(place.id); this.inventory.select(this.selected()?.id ?? ''); }
  }

  withdraw(item: InventoryItem): void {
    const place = this.selected();
    if (!place || this.modifying() || this.placesOpen()) return;
    try {
      this.inventory.removeItem(place.id, item.id);
      if (this.detailGroup()?.items.length === 0) this.closeDetails();
    }
    catch (error) { this.notifications.error(error instanceof Error ? error.message : 'No se pudo retirar la entrada.'); }
  }

  async retrySave(): Promise<void> {
    if (this.entryOpen() || this.action()) return;
    if (await this.inventory.save()) this.notifications.success('Cambios guardados.');
  }

  reload(): void {
    if (this.entryOpen() || this.action() || this.inventory.saving()) return;
    if (this.inventory.dirty() && !window.confirm('¿Quieres cargar el inventario guardado y descartar todos los cambios del borrador?')) return;
    void this.inventory.load(true).catch(() => undefined);
  }

}
