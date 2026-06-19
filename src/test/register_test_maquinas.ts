// src/test/register_test_maquinas.ts
import { prisma } from "../db";
import { CriticidadMaquina, EstadoMaquina } from "@prisma/client";

interface MaquinaInput {
  codigo: string;
  nombre: string;
  proceso: string;
  area: string;
  ubicacionDetalle: string;
  criticidad: "A" | "B" | "C";
}

const maquinas: MaquinaInput[] = [
  { codigo: "MBC0001", nombre: "Cabina Ecológica", proceso: "Cabina Ecologica", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0003", nombre: "Cabina Ecológica", proceso: "Cabina Ecologica", area: "Billeteras Lambda", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0004", nombre: "Banco con Brochuelos", proceso: "Banco con Brochuelos", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0005", nombre: "Banco con Brochuelos", proceso: "Banco con Brochuelos", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0006", nombre: "Maquina para pulir", proceso: "Pulir", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0007", nombre: "Maquina para pulir", proceso: "Pulir", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0008", nombre: "Banco de Lijas", proceso: "Banco de Lijas", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0009", nombre: "Banco para acabar Calzado", proceso: "Banco de Lijas", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0010", nombre: "Banco de Lijas", proceso: "Banco de Lijas", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0011", nombre: "Banco de Lijas", proceso: "Banco de Lijas", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0015", nombre: "Flameadora con vapor automática", proceso: "Flameadora", area: "Montado", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0018", nombre: "Modificada a cuatro estaciones", proceso: "Conformar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "B" },
  { codigo: "MBC0019", nombre: "Planchar tubo 4 estaciones", proceso: "Conformar", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "B" },
  { codigo: "MBC0020", nombre: "Troquelar", proceso: "Troquelar", area: "Acabado Riel", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "B" },
  { codigo: "MBC0021", nombre: "Maquina para Troquelar", proceso: "Troquelar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "B" },
  { codigo: "MBC0022", nombre: "Maquina de troquelar etiqueta", proceso: "Troquelar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "B" },
  { codigo: "MBC0023", nombre: "Maquina de grabar y timbrar", proceso: "Grabar", area: "Billeteras Lambda", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0024", nombre: "Troquelar Hidráulica", proceso: "Troquelar", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "B" },
  { codigo: "MBC0025", nombre: "Apomazadora", proceso: "Apomazadora", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0026", nombre: "Maquina para apomazar suela", proceso: "Apomazadora", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0027", nombre: "Pre acabar", proceso: "Preacabar", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "A" },
  { codigo: "MBC0029", nombre: "Desvirar Tacón", proceso: "Desvirar Tacon", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "A" },
  { codigo: "MBC0030", nombre: "Desvirar Tacón", proceso: "Desvirar Tacon", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "A" },
  { codigo: "MBC0032", nombre: "Entaconar automática", proceso: "Entaconar", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "B" },
  { codigo: "MBC0033", nombre: "Entaconar automática", proceso: "Entaconar", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "B" },
  { codigo: "MBC0035", nombre: "Remachar neumática", proceso: "Remachar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0036", nombre: "Remachar neumática", proceso: "Remachar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0037", nombre: "Remachar neumática", proceso: "Remachar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0038", nombre: "Coser Suela Stitcher", proceso: "Coser suela", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "A" },
  { codigo: "MBC0039", nombre: "Coser Suela Stitcher", proceso: "Coser suela", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "A" },
  { codigo: "MBC0041", nombre: "Asentar Suela", proceso: "Asentar Suela", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0043", nombre: "Costear", proceso: "Costear", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0044", nombre: "Coser Welt", proceso: "Coser Suela", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "A" },
  { codigo: "MBC0045", nombre: "Coser Welt", proceso: "Coser Suela", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "A" },
  { codigo: "MBC0046", nombre: "Coser Welt", proceso: "Coser suela", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "A" },
  { codigo: "MBC0047", nombre: "Rebatir Talón", proceso: "Rebatir Talon", area: "MONTADO", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "C" },
  { codigo: "MBC0048", nombre: "Maquina estabilizadora para humedecer", proceso: "Horno Estabilizador", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: "B" },
  { codigo: "MBC0049", nombre: "Horno de secado", proceso: "Horno de secado", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "B" },
  { codigo: "MBC0050", nombre: "Secador Activador", proceso: "Secador Activador", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: "B" },
  { codigo: "MBC0051", nombre: "Horno de secado", proceso: "Horno de secado", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "B" },
  { codigo: "MBC0052", nombre: "Prensar Tacón", proceso: "Prensar tacon", area: "Avios", ubicacionDetalle: "Planta Baja AVIOS", criticidad: "B" },
  { codigo: "MBC0053", nombre: "Clavadora para fijar Planta", proceso: "Clavadora", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: "C" },
  { codigo: "MBC0054", nombre: "Maquina engrapadora neumatica", proceso: "Engrapadora Neumatica", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0056", nombre: "Maquina Calcera Montar Talón", proceso: "Montar Talon", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: "B" },
  { codigo: "MBC0057", nombre: "Maq. de montar lados", proceso: "Montar Enfranques", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: "B" },
  { codigo: "MBC0058", nombre: "Montar Puntas", proceso: "Montar puntas", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: "B" },
  { codigo: "MBC0060", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0063", nombre: "Pesp. Cerrar", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0069", nombre: "Pesp. Plana 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0072", nombre: "Costura recta c/palanca de retroceso", proceso: "Pespuntar", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0077", nombre: "Pesp. Plana 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0078", nombre: "Plana 2 agujas", proceso: "Pespuntar", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0079", nombre: "Maquina de Pespuntar", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0080", nombre: "Pesp. Zic Zac", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0081", nombre: "Pesp. Zic Zac", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0082", nombre: "Pesp. Zic Zac", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0084", nombre: "Pesp. Zic Zac", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0085", nombre: "Pesp. Zic Zac", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0091", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0092", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Billeteras Lambda", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0093", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0101", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0103", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar", area: "Billeteras Lambda", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0104", nombre: "Pesp. Poste automática 1 agujas", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0105", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0107", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0108", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta DESUSO", criticidad: "C" },
  { codigo: "MBC0109", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar", area: "PESPUNTE", ubicacionDetalle: "Planta Alta DESUSO", criticidad: "C" },
  { codigo: "MBC0110", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0111", nombre: "Pesp. Poste automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0112", nombre: "Pesp. Poste automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0113", nombre: "Pesp. Poste automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0114", nombre: "Pesp. Poste automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0115", nombre: "Pesp. Poste automática 2 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0116", nombre: "Pesp. Poste automática 2 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0117", nombre: "Pesp. Poste automática 2 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0121", nombre: "Pesp. Sobre costura poste giratorio", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0122", nombre: "Pesp. Sobre costura poste giratorio", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0124", nombre: "Costura recta c/corte de hilo", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0126", nombre: "Costura recta c/corte de hilo", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0127", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0128", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0129", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0131", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0132", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0133", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0136", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0137", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0138", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE PRELIMINARES", criticidad: "C" },
  { codigo: "MBC0139", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0140", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0141", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0142", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0143", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0144", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0145", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0147", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0148", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0149", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0150", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0151", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0152", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0153", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0155", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0156", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0157", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0158", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Servicios", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0159", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0160", nombre: "Pesp. Plana", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0161", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0162", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0163", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0165", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0166", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0167", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0168", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Billeteras Lambda", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0169", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0172", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0173", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0174", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0176", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0177", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0178", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0179", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0181", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0182", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0183", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0184", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" },
  { codigo: "MBC0185", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0186", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0187", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0188", nombre: "Pesp. Plana", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0189", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0190", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0191", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0192", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0193", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0194", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0195", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0196", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta DESUSO", criticidad: "C" },
  { codigo: "MBC0197", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Billeteras Lambda", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0198", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: "C" },
  { codigo: "MBC0199", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: "C" },
  { codigo: "MBC0200", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: "C" }
];

const run = async () => {
  console.log(`🚀 Iniciando registro de ${maquinas.length} máquinas en base de datos...`);

  // Buscamos departamento de Mantenimiento y Producción Kappa por defecto
  const deptoMtto = await prisma.departamento.findFirst({
    where: { nombre: { contains: "Mantenimiento" } }
  });

  const deptoKappa = await prisma.departamento.findFirst({
    where: { nombre: { contains: "Kappa" } }
  });

  let registradas = 0;

  for (const m of maquinas) {
    // Deducimos la planta de la columna ubicacionDetalle
    const planta = m.ubicacionDetalle.includes("Planta Alta") ? "Planta Alta" : "Planta Baja";
    
    // Deducimos el departamento id
    let departamentoId = deptoMtto?.id || null;
    if (m.area.includes("Pespunte") || m.area.includes("Acabado") || m.area.includes("Montado") || m.area.includes("MONTADO")) {
      departamentoId = deptoKappa?.id || departamentoId;
    }

    await prisma.maquina.upsert({
      where: { codigo: m.codigo },
      update: {
        nombre: m.nombre,
        proceso: m.proceso,
        planta,
        area: m.area,
        ubicacionDetalle: m.ubicacionDetalle,
        criticidad: m.criticidad as CriticidadMaquina,
        departamentoId
      },
      create: {
        codigo: m.codigo,
        nombre: m.nombre,
        proceso: m.proceso,
        planta,
        area: m.area,
        ubicacionDetalle: m.ubicacionDetalle,
        criticidad: m.criticidad as CriticidadMaquina,
        estado: EstadoMaquina.OPERATIVA,
        departamentoId
      }
    });

    registradas++;
  }

  console.log(`✅ Ingesta finalizada. Total de máquinas registradas/actualizadas: ${registradas}`);
};

run()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
