import { Routes } from '@angular/router';
import { operatorSessionGuard } from './core/session/operator-session.guard';

export const appRoutes: Routes = [
  {
    path: 'sign-in',
    loadComponent: () =>
      import('./layout/sign-in/sign-in.page').then(
        ({ SignInPage }) => SignInPage,
      ),
  },
  {
    path: '',
    canActivate: [operatorSessionGuard],
    loadComponent: () =>
      import('./layout/shell/app-shell').then(({ AppShell }) => AppShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      {
        path: 'overview',
        loadComponent: () =>
          import('./features/overview/overview.page').then(
            ({ OverviewPage }) => OverviewPage,
          ),
      },
      {
        path: 'metrics',
        loadChildren: () =>
          import('./features/metrics/metrics.routes').then(
            ({ METRICS_ROUTES }) => METRICS_ROUTES,
          ),
      },
      {
        path: 'operations',
        loadChildren: () =>
          import('./features/operations/operations.routes').then(
            ({ OPERATIONS_ROUTES }) => OPERATIONS_ROUTES,
          ),
      },
      {
        path: 'configuration',
        loadComponent: () =>
          import('./features/configuration/configuration.page').then(
            ({ ConfigurationPage }) => ConfigurationPage,
          ),
      },
      {
        path: 'security',
        loadChildren: () =>
          import('./features/security/security.routes').then(
            ({ SECURITY_ROUTES }) => SECURITY_ROUTES,
          ),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () =>
      import('./layout/not-found/not-found.page').then(
        ({ NotFoundPage }) => NotFoundPage,
      ),
  },
];
