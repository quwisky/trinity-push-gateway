import { Routes } from '@angular/router';
import { provideSpartanDynamicForm } from '../../ui/form/spartan-form.provider';
import { OperationsPage } from './operations.page';

export const OPERATIONS_ROUTES: Routes = [
  {
    path: '',
    component: OperationsPage,
    providers: [provideSpartanDynamicForm()],
  },
];
