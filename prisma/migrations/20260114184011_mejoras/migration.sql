/*
  Warnings:

  - You are about to drop the column `motivoPausa` on the `tarea` table. All the data in the column will be lost.
  - You are about to drop the column `motivoRechazo` on the `tarea` table. All the data in the column will be lost.
  - You are about to drop the column `notasCierre` on the `tarea` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `imagen` ADD COLUMN `historialId` INTEGER NULL;

-- AlterTable
ALTER TABLE `tarea` DROP COLUMN `motivoPausa`,
    DROP COLUMN `motivoRechazo`,
    DROP COLUMN `notasCierre`,
    MODIFY `planta` VARCHAR(191) NULL,
    MODIFY `area` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `HistorialTarea` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tareaId` INTEGER NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `tipo` ENUM('CREACION', 'CAMBIO_ESTADO', 'ASIGNACION') NOT NULL,
    `estadoAnterior` ENUM('PENDIENTE', 'ASIGNADA', 'EN_PROGRESO', 'EN_PAUSA', 'RESUELTO', 'CERRADO', 'RECHAZADO', 'CANCELADA') NULL,
    `estadoNuevo` ENUM('PENDIENTE', 'ASIGNADA', 'EN_PROGRESO', 'EN_PAUSA', 'RESUELTO', 'CERRADO', 'RECHAZADO', 'CANCELADA') NULL,
    `nota` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `HistorialTarea` ADD CONSTRAINT `HistorialTarea_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `Tarea`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HistorialTarea` ADD CONSTRAINT `HistorialTarea_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Imagen` ADD CONSTRAINT `Imagen_historialId_fkey` FOREIGN KEY (`historialId`) REFERENCES `HistorialTarea`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
