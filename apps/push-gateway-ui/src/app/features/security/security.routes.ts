import { Routes } from '@angular/router';
import { provideSpartanDynamicForm } from '../../ui/form/spartan-form.provider';
import { SecurityPage } from './security.page';

export const SECURITY_ROUTES: Routes = [
  {
    path: '',
    component: SecurityPage,
    providers: [provideSpartanDynamicForm()],
  },
];
