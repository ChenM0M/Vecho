
import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation, RouteReuseStrategy } from '@angular/router';
import { AppComponent } from './src/app.component';
import { routes } from './src/app.routes';
import { CustomReuseStrategy } from './src/services/custom-reuse-strategy';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withHashLocation()
    ),
    { provide: RouteReuseStrategy, useClass: CustomReuseStrategy }
  ]
}).catch((err) => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.
