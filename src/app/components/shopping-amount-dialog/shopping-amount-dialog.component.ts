import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, OnInit, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Ingredient, RecipeIngredientAmount } from '../../models/recipe.model';
import { ShoppingItem } from '../../models/shopping-list.model';
import { validIngredientAmount } from '../../utils/ingredient-measures.utils';
import { lockDialogScroll } from '../../utils/dialog-scroll.utils';
import { IngredientAmountComponent } from '../shared/ingredient-amount/ingredient-amount.component';

@Component({
  selector: 'app-shopping-amount-dialog', standalone: true,
  imports: [ReactiveFormsModule, IngredientAmountComponent],
  templateUrl: './shopping-amount-dialog.component.html', styleUrl: './shopping-amount-dialog.component.css',
})
export class ShoppingAmountDialogComponent implements OnInit {
  readonly item = input.required<ShoppingItem>();
  readonly ingredient = input<Ingredient | undefined>();
  readonly confirmed = output<(RecipeIngredientAmount | null)[]>();
  readonly closed = output<void>();
  readonly amounts = signal<FormControl<RecipeIngredientAmount | null>[]>([]);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  constructor() {
    const document = inject(DOCUMENT); const previousFocus = document.activeElement as HTMLElement | null;
    const unlock = lockDialogScroll(document);
    afterNextRender(() => this.dialog().nativeElement.showModal());
    inject(DestroyRef).onDestroy(() => { this.dialog().nativeElement.close(); unlock(); if (previousFocus?.isConnected) previousFocus.focus(); });
  }
  ngOnInit(): void { this.amounts.set((this.item().amounts?.length ? this.item().amounts! : [null]).map(amount => new FormControl(structuredClone(amount)))); }
  valid(): boolean { return this.amounts().every(control => validIngredientAmount(control.value) && control.value?.kind !== 'glass'); }
  confirm(): void { if (this.valid()) this.confirmed.emit(this.amounts().map(control => structuredClone(control.value))); }
}
