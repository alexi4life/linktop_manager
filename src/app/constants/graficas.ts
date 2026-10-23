/**
 * Tipos, colores y utilidades comunes a las gráficas de históricos de todos
 * los dispositivos (monitor Linktop y anillo NexRing), para que se vean igual.
 */

/** Rangos de fechas disponibles en el selector de las gráficas. */
export type RangoGrafica = '24h' | '7d' | '30d' | 'todo';

/** Opciones del selector de rango, en el orden en que se muestran. */
export const OPCIONES_RANGO: { valor: RangoGrafica; texto: string }[] = [
  { valor: '24h', texto: '24h' },
  { valor: '7d', texto: '7 días' },
  { valor: '30d', texto: '30 días' },
  { valor: 'todo', texto: 'Todo' },
];

/** Un punto de una gráfica: momento de la medición (ISO 8601) y su valor. */
export interface PuntoGrafica {
  fecha: string;
  valor: number;
}

/** Describe una gráfica de históricos dentro de una página. */
export interface DefinicionGrafica {
  clave: string; // Identificador para buscar sus puntos en la página
  titulo: string;
  unidad: string;
  color: string;
  tipo?: 'line' | 'bar'; // Por defecto, línea
  decimales?: number; // Decimales que se muestran (ver DECIMALES); por defecto, 0
}

/**
 * Color de cada métrica, tomado de la paleta del sistema iOS.
 * La misma métrica tiene el mismo color en todos los dispositivos.
 */
export const COLORES_METRICA = {
  temperatura: '#ff9500',
  spo2: '#32ade6',
  pulso: '#ff3b30',
  hrv: '#af52de',
  sistolica: '#5856d6',
  diastolica: '#007aff',
  bateria: '#34c759',
  pasos: '#00c7be',
  movimiento: '#a2845e',
};

/** Devuelve la fecha de inicio que corresponde al rango elegido. */
export function calcularFechaDesde(rango: RangoGrafica): Date {
  const unDia = 24 * 60 * 60 * 1000;
  const ahora = Date.now();
  switch (rango) {
    case '24h':
      return new Date(ahora - unDia);
    case '7d':
      return new Date(ahora - 7 * unDia);
    case '30d':
      return new Date(ahora - 30 * unDia);
    case 'todo':
    default:
      return new Date(0);
  }
}

/**
 * Convierte registros guardados en puntos de gráfica, ordenados del más
 * antiguo al más reciente.
 *
 * Algunos SDK entregan los valores como texto (el anillo devuelve la
 * temperatura con `toFixed`, p. ej. "36.5"), así que se convierten a número.
 * Se descartan los valores vacíos o nulos, para no dibujarlos como 0.
 *
 * @param registros - Registros del historial (de cualquier dispositivo).
 * @param campo - Nombre del valor dentro de `valores` que se quiere dibujar.
 */
export function aPuntos(
  registros: { fecha: string; valores: Record<string, unknown> }[],
  campo: string,
): PuntoGrafica[] {
  return registros
    .map((r) => ({ fecha: r.fecha, original: r.valores[campo] }))
    .filter((p) => p.original !== null && p.original !== '')
    .map((p) => ({ fecha: p.fecha, valor: Number(p.original) }))
    .filter((p) => Number.isFinite(p.valor))
    .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
}
