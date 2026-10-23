import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgFor } from '@angular/common';
import {
  IonLabel,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular/standalone';

/** Una opción del segmento: valor interno y texto que ve el usuario. */
export interface OpcionSegmento<T extends string = string> {
  valor: T;
  texto: string;
}

/**
 * Segmento con estilo iOS, común a toda la app. Se usa para cambiar de
 * sección dentro de un dispositivo y para elegir el rango de las gráficas.
 */
@Component({
  selector: 'app-segmento-ios',
  templateUrl: './segmento-ios.component.html',
  styleUrls: ['./segmento-ios.component.scss'],
  standalone: true,
  imports: [NgFor, IonSegment, IonSegmentButton, IonLabel],
})
export class SegmentoIosComponent {
  @Input() opciones: OpcionSegmento[] = [];
  @Input() valor = '';

  /** Emite el nuevo valor cada vez que el usuario cambia de opción. */
  @Output() valorChange = new EventEmitter<any>();

  cambiar(valor: string) {
    this.valor = valor;
    this.valorChange.emit(valor);
  }
}
