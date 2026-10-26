import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Canal común para que los servicios Bluetooth (monitor y anillo) comuniquen
 * errores al usuario. Un único suscriptor (AppComponent) los muestra en pantalla.
 */
@Injectable({
  providedIn: 'root',
})
export class AvisosService {
  private errorSubject = new Subject<string>();

  /** Mensajes de error pendientes de mostrar. */
  error$ = this.errorSubject.asObservable();

  /** Publica un error para que se muestre al usuario. */
  error(mensaje: string) {
    this.errorSubject.next(mensaje);
  }
}
