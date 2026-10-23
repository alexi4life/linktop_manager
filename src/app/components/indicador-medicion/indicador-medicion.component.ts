import { Component, Input } from '@angular/core';
import { NgIf } from '@angular/common';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { handLeftOutline } from 'ionicons/icons';

/**
 * Indicador que sustituye al valor de una tarjeta mientras dura una medición
 * que no es instantánea. Es el mismo en todos los dispositivos.
 *
 * Si el sensor detecta el dedo, se le indica con `sinDedo`: mientras no lo
 * detecte se pide al usuario que lo coloque, y al detectarlo pasa a "Midiendo…".
 */
@Component({
  selector: 'app-indicador-medicion',
  templateUrl: './indicador-medicion.component.html',
  styleUrls: ['./indicador-medicion.component.scss'],
  standalone: true,
  imports: [NgIf, IonIcon, IonSpinner],
})
export class IndicadorMedicionComponent {
  /** true mientras el sensor no detecta el dedo (solo sensores que lo detectan). */
  @Input() sinDedo = false;

  /** Texto que se muestra mientras no hay dedo. */
  @Input() textoSinDedo = 'Coloca el dedo en el sensor';

  constructor() {
    addIcons({ handLeftOutline });
  }
}
