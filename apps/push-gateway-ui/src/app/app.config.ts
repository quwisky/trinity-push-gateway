import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withXsrfConfiguration } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { appRoutes } from './app.routes';
import { ThemeService } from './core/theme/theme.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideAppInitializer(() => {
      inject(ThemeService);
    }),
    provideHttpClient(
      withXsrfConfiguration({
        cookieName: 'TRINITY_ADMIN_XSRF',
        headerName: 'X-XSRF-TOKEN',
      }),
    ),
    provideRouter(appRoutes),
  ],
};
