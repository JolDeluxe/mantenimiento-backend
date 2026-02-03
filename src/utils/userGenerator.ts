//Este codigo genera posibles usernames basados en el nombre completo del usuario.

export const generarUsername = (nombreCompleto: string): string[] => {

    const limpio = nombreCompleto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

  const partes = limpio.split(" ").filter(Boolean);

  if (partes.length === 0) return ["usuario.nuevo"];

  const opciones: string[] = [];
  
  const primerNombre = partes[0];

  if (partes.length > 1) {
    opciones.push(`${primerNombre}.${partes[1]}`);
  }

  if (partes.length >= 3) {
    opciones.push(`${partes[1]}.${partes[2]}`); 
  }

  if (partes.length >= 3) {
    const ultimo = partes[partes.length - 1];
    opciones.push(`${primerNombre}.${ultimo}`);
  }

  if (partes.length >= 3) {
    const paterno = partes[partes.length - 2];
    const materno = partes[partes.length - 1]; 
    if (paterno && materno) {
       opciones.push(`${primerNombre}.${paterno}.${materno.charAt(0)}`);
    }
  }

  if (opciones.length === 0) {
    opciones.push(primerNombre!);
  }

  return [...new Set(opciones)];
};