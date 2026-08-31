import { Routes } from '@angular/router';
import { provideSpartanDynamicForm } from '../../ui/form/spartan-form.provider';
import { MetricsPage } from './metrics.page';

export const METRICS_ROUTES: Routes = [
  {
    path: '',
    component: MetricsPage,
    providers: [provideSpartanDynamicForm()],
  },
];
