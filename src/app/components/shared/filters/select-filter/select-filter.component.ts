import { Component, forwardRef, Input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SelectFilterOption, SelectFilterType } from '../select-filter-options';
import { IconComponent } from '../../icon/icon.component';


@Component({
  selector: 'app-select-filter',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './select-filter.component.html',
  styleUrl: './select-filter.component.css',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectFilterComponent), multi: true }],
})
export class SelectFilterComponent implements ControlValueAccessor {
  @Input() label = '';
  @Input() filterType: SelectFilterType = 'ingredient-category';
  @Input() options: SelectFilterOption[] = [];
  @Input() placeholder = '';
  @Input() ariaLabel = '';

  value = '';
  disabled = false;
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    this.value = value ?? '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  updateValue(value: string): void {
    this.value = value;
    this.onChange(value);
  }

  markTouched(): void {
    this.onTouched();
  }
}


