import { Component, input } from '@angular/core';

export type IconName = 'recipes' | 'ingredients' | 'search' | 'chevron-down' | 'clock' | 'person' | 'star' | 'check' | 'warning' | 'close' | 'pending' | 'arrow-right' | 'arrow-up-right' | 'command' | 'sparkle' | 'plus';

@Component({
  selector: 'app-icon',
  standalone: true,
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.css',
})
export class IconComponent {
  readonly name = input.required<IconName>();
  iconUrl(): string { return `/assets/icons/ui/${this.name()}.svg`; }
}
