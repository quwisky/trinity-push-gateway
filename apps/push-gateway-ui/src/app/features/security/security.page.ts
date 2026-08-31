import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'tpg-security-page',
  template: `
    <header class="page-header">
      <p class="eyebrow">Operator access</p>
      <h1>Security</h1>
      <p class="lede">
        Bounded Operator Sessions and privacy-safe Operator Audit Entries.
      </p>
    </header>
    <section class="empty-state" aria-labelledby="security-state-title">
      <h2 id="security-state-title">Security data is not connected</h2>
      <p>
        Identity-provider accounts and groups remain owned by the configured
        provider, not by this interface.
      </p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecurityPage {}
