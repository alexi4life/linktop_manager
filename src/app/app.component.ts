import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonApp,
  IonRouterOutlet,
  ToastController,
} from '@ionic/angular/standalone';
import { AvisosService } from './services/avisos.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  private toastCtrl = inject(ToastController);

  constructor() {
    inject(AvisosService)
      .error$.pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((mensaje) => this.mostrarError(mensaje));
  }

  /** Muestra un error de Bluetooth como aviso rojo en la parte superior. */
  private async mostrarError(mensaje: string) {
    const toast = await this.toastCtrl.create({
      message: mensaje,
      duration: 3500,
      position: 'top',
      color: 'danger',
      mode: 'ios',
    });
    await toast.present();
  }
}
