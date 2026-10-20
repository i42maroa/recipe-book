import { ChangeDetectorRef, Component, forwardRef, inject, Input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IconComponent } from '../../icon/icon.component';

@Component({
  selector: 'app-search-filter',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './search-filter.component.html',
  styleUrl: './search-filter.component.css',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SearchFilterComponent), multi: true }],
})
export class SearchFilterComponent implements ControlValueAccessor {
  @Input() placeholder = 'Buscar…';
  @Input() ariaLabel = 'Buscar';
  @Input() shortcut = '';
  value = '';
  disabled = false;
  private readonly changeDetector = inject(ChangeDetectorRef);

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null): void { this.value = value ?? ''; this.changeDetector.markForCheck(); }
  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.disabled = disabled; this.changeDetector.markForCheck(); }
  updateValue(value: string): void { this.value = value; this.onChange(value); }
  markTouched(): void { this.onTouched(); }
}

