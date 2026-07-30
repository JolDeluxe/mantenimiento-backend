/**
 * Reservado para Etapa 3. No se registra en scheduler ni procesa backlog en Etapa 1.
 */
export async function procesarActividadesRecurrentesProgramadas() {
  return { habilitado: false, procesadas: 0, creadas: 0, errores: 0 };
}
