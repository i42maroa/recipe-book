import { Component, ElementRef, HostListener, forwardRef, inject, Input, OnChanges } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SelectFilterOption, SelectFilterType } from '../select-filter-options';
import { IconComponent } from '../../icon/icon.component';

let nextSelectId = 0;

@Component({
  selector: 'app-select-filter',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './select-filter.component.html',
  styleUrl: './select-filter.component.css',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectFilterComponent), multi: true }],
})
export class SelectFilterComponent implements ControlValueAccessor, OnChanges {
  @Input() label = '';
  @Input() filterType: SelectFilterType = 'ingredient-category';
  @Input() options: SelectFilterOption[] = [];
  @Input() placeholder = '';
  @Input() ariaLabel = '';

  value = '';
  disabled = false;
  opened = false;
  activeIndex = 0;
  readonly selectId = `select-filter-${nextSelectId++}`;
  private readonly element = inject(ElementRef<HTMLElement>);
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  displayOptions: SelectFilterOption[] = [];
  ngOnChanges(): void {
    this.displayOptions = this.placeholder ? [{ value: '', label: this.placeholder }, ...this.options] : this.options;
    this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.displayOptions.length - 1));
  }
  get selectedLabel(): string {
    return this.displayOptions.find((option) => option.value === this.value)?.label ?? '';
  }
  writeValue(value: string | null): void { this.value = value ?? ''; }
  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
    if (disabled) this.opened = false;
  }
  updateValue(value: string): void {
    this.value = value;
    this.onChange(value);
    this.opened = false;
    this.markTouched();
  }
  markTouched(): void { this.onTouched(); }
  toggle(): void {
    if (this.disabled) return;
    if (this.opened) this.opened = false;
    else this.open();
  }
  private open(): void {
    this.activeIndex = Math.max(0, this.displayOptions.findIndex((option) => option.value === this.value));
    this.opened = true;
    this.scrollActiveOption();
  }
  onKeydown(event: KeyboardEvent): void {
    if (this.disabled) return;
    const count = this.displayOptions.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        if (!this.opened) this.open();
        else this.activeIndex = Math.max(0, Math.min(count - 1, this.activeIndex + (event.key === 'ArrowDown' ? 1 : -1)));
        this.scrollActiveOption();
        break;
      case 'Home':
      case 'End':
        if (!this.opened) return;
        event.preventDefault();
        this.activeIndex = event.key === 'Home' ? 0 : Math.max(0, count - 1);
        this.scrollActiveOption();
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!this.opened) this.open();
        else if (count) this.updateValue(this.displayOptions[this.activeIndex].value);
        break;
      case 'Escape':
        if (!this.opened) return;
        event.preventDefault();
        event.stopPropagation();
        this.opened = false;
        break;
      case 'Tab':
        this.opened = false;
        break;
    }
  }
  private scrollActiveOption(): void {
    requestAnimationFrame(() => {
      if (this.opened) this.element.nativeElement.querySelector(`#${this.selectId}-option-${this.activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    });
  }
  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent): void {
    if (this.opened && !this.element.nativeElement.contains(event.target as Node)) this.opened = false;
  }
  onBlur(): void {
    this.opened = false;
    this.markTouched();
  }
}
