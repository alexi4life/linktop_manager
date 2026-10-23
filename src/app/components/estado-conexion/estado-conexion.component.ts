import { Component, Input } from '@angular/core';

/** Estados de conexión posibles, comunes a todos los dispositivos. */
export type EstadoConexion =
  | 'sin-conectar'
  | 'buscando'
  | 'conectado'
  | 'reposo' // Vinculado pero dormido para ahorrar batería (solo el anillo)
  | 'error';

/** Texto que se muestra para cada estado. */
const TEXTOS: Record<EstadoConexion, string> = {
  'sin-conectar': '⚪ Sin conectar',
  buscando: '🔍 Buscando…',
  conectado: '🟢 Conectado',
  reposo: '🌙 En reposo (ahorro de batería)',
  error: '⚠️ Error de Bluetooth',
};

/**
 * Tarjeta con el estado de la conexión Bluetooth del dispositivo.
 * Es la misma en todas las páginas para que los mensajes sean coherentes.
 */
@Component({
  selector: 'app-estado-conexion',
  templateUrl: './estado-conexion.component.html',
  styleUrls: ['./estado-conexion.component.scss'],
  standalone: true,
})
export class EstadoConexionComponent {
  @Input() estado: EstadoConexion = 'sin-conectar';

  /** Dato adicional opcional, por ejemplo el nombre del dispositivo. */
  @Input() detalle = '';

  get texto(): string {
    return this.detalle
      ? `${TEXTOS[this.estado]} · ${this.detalle}`
      : TEXTOS[this.estado];
  }
}
