/*
  Warnings:

  - Made the column `planta` on table `departamento` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tipo` on table `departamento` required. This step will fail if there are existing NULL values in that column.
  - Made the column `planta` on table `tarea` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `departamento` MODIFY `planta` ENUM('KAPPA', 'OMEGA', 'SIGMA', 'LAMBDA') NOT NULL,
    MODIFY `tipo` ENUM('ADMINISTRATIVO', 'OPERATIVO') NOT NULL;

-- AlterTable
ALTER TABLE `tarea` ADD COLUMN `departamentoId` INTEGER NULL,
    MODIFY `planta` ENUM('KAPPA', 'OMEGA', 'SIGMA', 'LAMBDA') NOT NULL DEFAULT 'KAPPA';

-- AlterTable
ALTER TABLE `usuario` ADD COLUMN `telefono` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Tarea` ADD CONSTRAINT `Tarea_departamentoId_fkey` FOREIGN KEY (`departamentoId`) REFERENCES `Departamento`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
