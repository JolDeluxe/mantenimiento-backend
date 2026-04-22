/*
  Warnings:

  - The values [MEJORA,INFRAESTRUCTURA,RUTINA] on the enum `Tarea_clasificacion` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `tarea` MODIFY `clasificacion` ENUM('PREVENTIVO', 'CORRECTIVO', 'INSPECCION') NOT NULL DEFAULT 'CORRECTIVO';
