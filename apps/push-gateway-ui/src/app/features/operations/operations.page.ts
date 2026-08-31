import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { DynamicForm, FormConfig } from '@ng-forge/dynamic-forms';
import { standardSchema } from '@ng-forge/dynamic-forms/schema';
import * as z from 'zod/mini';
import './form/spartan-form.types';

const operationFilterSchema = z.object({
  search: z.string().check(z.maxLength(80)),
  since: z.string().check(z.maxLength(32)),
  outcome: z.enum(['all', 'succeeded', 'failed']),
  includeCompleted: z.boolean(),
});

const operationFilterForm = {
  fields: [
    {
      key: 'search',
      type: 'input',
      value: '',
      label: 'Operation type',
      placeholder: 'For example, backup',
      props: {
        type: 'text',
        hint: 'Filters locally; it never starts an action.',
      },
    },
    {
      key: 'since',
      type: 'datetime',
      value: '',
      label: 'Observed since',
      props: { hint: 'Uses the browser locale for input only.' },
    },
    {
      key: 'outcome',
      type: 'select',
      value: 'all',
      label: 'Outcome',
      options: [
        { value: 'all', label: 'All outcomes' },
        { value: 'succeeded', label: 'Succeeded' },
        { value: 'failed', label: 'Failed' },
      ],
    },
    {
      key: 'includeCompleted',
      type: 'checkbox',
      value: true,
      label: 'Include completed operations',
    },
    { key: 'apply', type: 'submit', label: 'Apply filters' },
  ],
  schema: standardSchema(operationFilterSchema),
} as const satisfies FormConfig;

@Component({
  selector: 'tpg-operations-page',
  imports: [DynamicForm],
  template: `
    <header class="page-header">
      <p class="eyebrow">Bounded actions</p>
      <h1>Operations</h1>
      <p class="lede">
        Review synchronous Gateway Operator actions without general process,
        filesystem, or database access.
      </p>
    </header>

    <section class="content-panel" aria-labelledby="operation-filter-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Local filter foundation</p>
          <h2 id="operation-filter-title">Filter operation history</h2>
        </div>
        <span class="status-pill">No request sent</span>
      </div>
      <form
        class="filter-form"
        [dynamic-form]="filterForm"
        (submitted)="applyFilters()"
      ></form>
      @if (filtersApplied()) {
        <p class="success-message" role="status">
          Filters validated locally. Operational data is not connected yet.
        </p>
      }
    </section>

    <section class="empty-state" aria-labelledby="operations-state-title">
      <h2 id="operations-state-title">Operator actions are not connected</h2>
      <p>
        Firebase validation, cleanup, and verified backup services are added by
        later isolated administration tasks.
      </p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperationsPage {
  protected readonly filterForm = operationFilterForm;
  protected readonly filtersApplied = signal(false);

  protected applyFilters(): void {
    this.filtersApplied.set(true);
  }
}
