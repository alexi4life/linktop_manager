import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

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
  /**
   * Guarda una nueva medición en el almacén local del dispositivo.
   * Añade el registro al final de la lista existente, sin borrar nada anterior.
   *
   * @param tipo - Tipo de sensor que generó la medición.
   * @param valores - Los datos numéricos concretos de esa medición.
   */
  async guardarMedicion(
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
  }

  /**
   * Recupera todo el historial guardado en el dispositivo.
   * Si no hay nada guardado todavía, devuelve un array vacío.
   */
  async obtenerHistorial(): Promise<RegistroMedicion[]> {
    const resultado = await Preferences.get({ key: CLAVE_HISTORIAL });
    if (!resultado.value) return [];
    return JSON.parse(resultado.value);
  }

  /**
   * Recupera solo la última medición guardada de un tipo concreto.
   * Útil para mostrar "tu última temperatura" sin tener que filtrar todo el historial cada vez.
   *
   * @param tipo - Tipo de sensor a consultar.
   */
  async obtenerUltimaMedicion(
    tipo: RegistroMedicion['tipo'],
  ): Promise<RegistroMedicion | null> {
    const historial = await this.obtenerHistorial();
    const filtradas = historial.filter((r) => r.tipo === tipo);
    if (filtradas.length === 0) return null;
    return filtradas[filtradas.length - 1];
  }

  /**
   * Borra todo el historial guardado. Pensado para un futuro botón de "reiniciar datos".
   */
  async borrarHistorial(): Promise<void> {
    await Preferences.remove({ key: CLAVE_HISTORIAL });
  }
}
