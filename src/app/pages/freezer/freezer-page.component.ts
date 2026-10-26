import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FreezerEntryDialogComponent } from '../../components/freezer-entry-dialog/freezer-entry-dialog.component';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { SkeletonComponent } from '../../components/shared/skeleton/skeleton.component';
import { SearchFilterComponent } from '../../components/shared/filters/search-filter/search-filter.component';
import { SelectFilterComponent } from '../../components/shared/filters/select-filter/select-filter.component';
import { SelectFilterOption } from '../../components/shared/filters/select-filter-options';
import { FreezerItem } from '../../models/freezer.model';
import { AuthService } from '../../services/auth.service';
import { FreezerService } from '../../services/freezer.service';
import { FreezerNavigationService } from '../../services/freezer-navigation.service';
import { NotificationService } from '../../services/notification.service';
import { FreezerSort, freezerAmountLabel, sortFreezerItems } from '../../utils/freezer.utils';
import { ingredientCategoryLabel } from '../../utils/recipe-display.utils';
import { normalizeSearch } from '../../utils/search.utils';

type InventoryAction = { kind: 'create' } | { kind: 'rename'; freezerId: string } | { kind: 'withdraw'; item: FreezerItem };

@Component({
  selector: 'app-freezer-page', standalone: true,
  imports: [ReactiveFormsModule, FreezerEntryDialogComponent, IconComponent, SkeletonComponent, SearchFilterComponent, SelectFilterComponent],
  templateUrl: './freezer-page.component.html',
  styleUrl: './freezer-page.component.css',
})
export class FreezerPageComponent {
  readonly inventory = inject(FreezerService);
  private readonly navigation = inject(FreezerNavigationService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly owner = this.auth.user()?.id;
  private readonly actionDialog = viewChild<ElementRef<HTMLDialogElement>>('actionDialog');
  private readonly entryDialog = viewChild(FreezerEntryDialogComponent);
  readonly selected = this.inventory.selected;
  readonly search = new FormControl('', { nonNullable: true });
  readonly sort = new FormControl<FreezerSort>('oldest', { nonNullable: true });
  private readonly searchValue = toSignal(this.search.valueChanges, { initialValue: this.search.value });
  private readonly sortValue = toSignal(this.sort.valueChanges, { initialValue: this.sort.value });
  readonly sortOptions: SelectFilterOption[] = [
    { value: 'oldest', label: 'Más antiguos' }, { value: 'newest', label: 'Más recientes' },
    { value: 'name', label: 'Nombre A–Z' }, { value: 'name-desc', label: 'Nombre Z–A' },
  ];
  readonly items = computed(() => sortFreezerItems((this.selected()?.items ?? [])
    .filter(item => normalizeSearch(item.name).includes(normalizeSearch(this.searchValue()))), this.sortValue()));
  readonly entryOpen = signal(false);
  readonly editingItem = signal<FreezerItem | null>(null);
  readonly action = signal<InventoryAction | null>(null);
  readonly actionError = signal('');
  readonly freezerName = new FormControl('', { nonNullable: true });
  readonly withdrawQuantity = new FormControl<number | null>(null);
  readonly withdrawAll = new FormControl(false, { nonNullable: true });
  readonly blocked = computed(() => !this.inventory.ready() || this.inventory.loading() || !!this.inventory.error());
  readonly busy = computed(() => this.blocked() || this.entryOpen() || !!this.action());
  readonly actionTitle = computed(() => this.action()?.kind === 'create' ? 'Nuevo congelador' : this.action()?.kind === 'rename' ? 'Renombrar congelador' : 'Retirar cantidad');
  readonly withdrawing = computed(() => { const action = this.action(); return action?.kind === 'withdraw' ? action.item : null; });
  readonly amountLabel = freezerAmountLabel;
  readonly categoryLabel = ingredientCategoryLabel;

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => { this.navigation.blocked.set(this.busy()); });
    destroyRef.onDestroy(() => this.navigation.blocked.set(true));
    this.navigation.actions$.pipe(takeUntilDestroyed()).subscribe(action => {
      if (this.busy()) return;
      if (action.kind === 'create') this.openAction({ kind: 'create' });
      else if (action.kind === 'select') this.choose(action.id);
      else if (action.kind === 'remove') this.removeFreezer();
      else {
        const freezer = this.selected();
        if (freezer) this.openAction({ kind: 'rename', freezerId: freezer.id });
      }
    });
    effect(() => {
      if (!this.auth.canEdit() || this.auth.user()?.id !== this.owner) {
        this.entryOpen.set(false); this.closeAction(); void this.router.navigate(['/login']);
      }
    });
    effect(onCleanup => {
      if (!this.action()) return;
      const previousOverflow = this.document.body.style.overflow;
      this.document.body.style.overflow = 'hidden';
      onCleanup(() => { this.document.body.style.overflow = previousOverflow; });
    });
    void this.inventory.load().catch(() => undefined);
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.inventory.dirty() || this.inventory.saving() || this.entryDialog()?.creating() || this.entryDialog()?.hasChanges() || this.action()) event.preventDefault();
  }

  canLeave(): boolean {
    if (this.inventory.saving() || this.entryDialog()?.creating()) return false;
    if (this.entryDialog()?.hasChanges()) return window.confirm('¿Quieres salir y descartar los cambios del formulario abierto? El borrador del listado se conserva.');
    return true;
  }

  choose(id: string): void { this.inventory.selectedId.set(id); this.search.setValue(''); }

  openEntries(item: FreezerItem | null = null): void {
    if (this.busy() || !this.selected()) return;
    this.editingItem.set(item); this.entryOpen.set(true);
  }

  confirmEntries(items: FreezerItem[]): void {
    const freezer = this.selected();
    if (!freezer || this.blocked()) return;
    try {
      const applied = this.editingItem() ? this.inventory.updateItem(freezer.id, items[0]) : this.inventory.addItems(freezer.id, items);
      if (applied) this.entryOpen.set(false);
    } catch (error) { this.notifications.error(error instanceof Error ? error.message : 'No se pudieron añadir las entradas.'); }
  }

  openAction(action: InventoryAction): void {
    if (this.busy()) return;
    this.freezerName.setValue(action.kind === 'rename' ? this.selected()?.name ?? '' : '');
    this.withdrawAll.setValue(action.kind === 'withdraw' && action.item.amount?.kind !== 'specific');
    this.withdrawQuantity.setValue(null); this.actionError.set(''); this.action.set(action);
    this.actionDialog()?.nativeElement.showModal();
  }

  closeAction(): void { this.action.set(null); this.actionDialog()?.nativeElement.close(); }

  applyAction(event: Event): void {
    event.preventDefault();
    const action = this.action();
    if (!action || this.blocked()) return;
    try {
      if (action.kind === 'withdraw') {
        const freezer = this.selected();
        if (!freezer) return;
        if (this.withdrawAll.value || action.item.amount?.kind !== 'specific') this.inventory.removeItem(freezer.id, action.item.id);
        else this.inventory.withdraw(freezer.id, action.item.id, this.withdrawQuantity.value ?? NaN);
      } else {
        const name = this.freezerName.value.trim();
        if (!name) { this.actionError.set('Escribe un nombre para el congelador.'); return; }
        if (action.kind === 'rename') this.inventory.rename(action.freezerId, name);
        else {
          const id = this.inventory.create(name);
          if (id) this.choose(id);
        }
      }
      this.closeAction();
    } catch (error) { this.actionError.set(error instanceof Error ? error.message : 'Revisa los datos.'); }
  }

  removeFreezer(): void {
    const freezer = this.selected();
    if (!freezer || this.busy() || freezer.items.length) return;
    if (window.confirm(`¿Quieres eliminar el congelador «${freezer.name}»?`)) this.inventory.removeFreezer(freezer.id);
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

  dateLabel(date: string): string { return date.split('-').reverse().join('/'); }
}
