import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-filter-container',
  standalone: true,
  templateUrl: './filter-container.component.html',
  styleUrl: './filter-container.component.css',
})
export class FilterContainerComponent {
  @Input() layout: 'row' | 'column' | 'search-select' = 'row';
  @Input() gap = '10px';
}

