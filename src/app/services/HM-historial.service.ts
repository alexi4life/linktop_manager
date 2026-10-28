import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { Subject } from 'rxjs';

//TODO - Por ahora el historial es local

// Clave única bajo la que guardamos todo el historial en el almacén del dispositivo
const CLAVE_HISTORIAL = 'historial_mediciones';

/**
 * Representa una medición guardada.
 * El campo "sincronizado" está pensado para cuando haya conexión a un servidor: permite
 * saber qué registros faltan por enviar sin tener que rehacer el modelo de datos.
 */
export interface RegistroMedicion {
  id: string;
  tipo: 'temperatura' | 'oxigeno' | 'presion' | 'ecg' | 'bateria' | 'glucosa';
  valores: Record<string, number>;
  fecha: string; // formato ISO 8601, ej: "2026-07-14T10:30:00.000Z"
  sincronizado: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class HistorialService {
  public datosActualizados$ = new Subject<void>();

  // Cadena de escrituras: evita que dos guardados simultáneos lean el mismo
  // estado y uno pise al otro
  private cola: Promise<unknown> = Promise.resolve();

  /** Ejecuta la tarea cuando terminen las anteriores. */
  private enCola<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = this.cola.then(tarea);
    this.cola = resultado.catch(() => undefined);
    return resultado;
  }

  /**
   * Guarda una nueva medición en el almacén local del dispositivo.
   * Añade el registro al final de la lista existente, sin borrar nada anterior.
   *
   * @param tipo - Tipo de sensor que generó la medición.
   * @param valores - Los datos numéricos concretos de esa medición.
   */
  guardarMedicion(
    tipo: RegistroMedicion['tipo'],
    valores: Record<string, number>,
  ): Promise<void> {
    return this.enCola(() => this.escribirMedicion(tipo, valores));
  }

  private async escribirMedicion(
    tipo: RegistroMedicion['tipo'],
    valores: Record<string, number>,
  ): Promise<void> {
    const historial = await this.obtenerHistorial();

    const nuevoRegistro: RegistroMedicion = {
      id: crypto.randomUUID(),
      tipo,
      valores,
      fecha: new Date().toISOString(),
      sincronizado: false,
    };

    historial.push(nuevoRegistro);

    await Preferences.set({
      key: CLAVE_HISTORIAL,
      value: JSON.stringify(historial),
    });
    this.datosActualizados$.next();
  }

  /**
   * Recupera todo el historial guardado en el dispositivo.
   * Si no hay nada guardado todavía, devuelve un array vacío.
   */
  async obtenerHistorial(): Promise<RegistroMedicion[]> {
    const resultado = await Preferences.get({ key: CLAVE_HISTORIAL });
    try {
      return resultado.value ? JSON.parse(resultado.value) : [];
    } catch (error) {
      console.error('Error al leer el historial del Health Monitor:', error);
      return [];
    }
  }

  /**
   * Devuelve los registros dentro de un rango de fechas, agrupados por tipo.
   * Lee el almacén UNA sola vez, en lugar de una lectura por cada tipo; es lo
   * que usan las gráficas, que necesitan todos los tipos a la vez.
   *
   * @param desde - Fecha de inicio del rango (inclusive).
   * @param hasta - Fecha de fin del rango (inclusive). Por defecto, el momento actual.
   */
  async obtenerAgrupadoPorTipo(
    desde: Date,
    hasta: Date = new Date(),
  ): Promise<Partial<Record<RegistroMedicion['tipo'], RegistroMedicion[]>>> {
    const agrupado: Partial<
      Record<RegistroMedicion['tipo'], RegistroMedicion[]>
    > = {};
    for (const registro of await this.obtenerHistorial()) {
      const fecha = new Date(registro.fecha);
      if (fecha < desde || fecha > hasta) continue;
      (agrupado[registro.tipo] ??= []).push(registro);
    }
    return agrupado;
  }

}
