import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'tabs',
    loadComponent: () => import('./tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      {
        path: 'healthmonitor',
        loadComponent: () =>
          import('./HM-home/HM-home.page').then((m) => m.HomePage),
      },
      {
        path: 'nexring',
        loadComponent: () =>
          import('./ring-home/ring-home.page').then((m) => m.RingHomePage),
      },
      {
        path: '',
        redirectTo: 'healthmonitor',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    redirectTo: 'tabs',
    pathMatch: 'full',
  },
];
