import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formato común de los valores numéricos que se muestran en la app, según la
 * norma habitual en español (SI/BIPM y RAE): coma decimal y una precisión
 * acorde a cada magnitud. La unidad se escribe aparte, separada por un espacio.
 */

/** Decimales que se muestran de cada magnitud (por defecto, ninguno). */
export const DECIMALES = {
  temperatura: 1, // 36,6 °C
  porcentaje: 0, // SpO2 y batería: 97 %
  pulso: 0, // 72 lpm
  hrv: 0, // 45 ms
  presion: 0, // 120 mmHg
};

// Se reutiliza un formateador por número de decimales, en vez de crear uno por valor
const formateadores = new Map<number, Intl.NumberFormat>();

/**
 * Formatea un número en español con, como mucho, los decimales indicados.
 * Si el valor no es un número (p. ej. el marcador "--" de un dato vacío), se
 * devuelve tal cual, para no cambiar cómo se muestran los datos sin medir.
 *
 * @param valor - Número a formatear (admite texto numérico, como "36.5").
 * @param decimales - Número máximo de decimales.
 */
export function formatearNumero(
  valor: number | string | null | undefined,
  decimales: number = 0,
): string {
  const numero = typeof valor === 'string' ? Number(valor) : valor;
  if (numero === null || numero === undefined || !Number.isFinite(numero)) {
    return valor === null || valor === undefined ? '' : String(valor);
  }

  let formateador = formateadores.get(decimales);
  if (!formateador) {
    formateador = new Intl.NumberFormat('es-ES', {
      maximumFractionDigits: decimales,
    });
    formateadores.set(decimales, formateador);
  }
  return formateador.format(numero);
}

/** Pipe para usar formatearNumero en las plantillas: {{ valor | numero:1 }} */
@Pipe({ name: 'numero', standalone: true })
export class NumeroPipe implements PipeTransform {
  transform(
    valor: number | string | null | undefined,
    decimales: number = 0,
  ): string {
    return formatearNumero(valor, decimales);
  }
}
