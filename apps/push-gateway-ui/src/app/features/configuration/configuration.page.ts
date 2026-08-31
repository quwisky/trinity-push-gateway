import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'tpg-configuration-page',
  template: `
    <header class="page-header">
      <p class="eyebrow">Read-only</p>
      <h1>Configuration</h1>
      <p class="lede">
        Effective non-secret settings and secret presence, never secret values.
      </p>
    </header>
    <section class="empty-state" aria-labelledby="configuration-state-title">
      <h2 id="configuration-state-title">Configuration is not connected</h2>
      <p>
        Configuration editing, secret editing, and live reload are outside the
        Push Gateway UI boundary.
      </p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigurationPage {}
