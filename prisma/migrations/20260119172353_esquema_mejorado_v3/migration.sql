/*
  Warnings:

  - You are about to alter the column `planta` on the `departamento` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(5))` to `VarChar(191)`.
  - You are about to alter the column `tipo` on the `departamento` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(7))` to `VarChar(191)`.
  - You are about to alter the column `planta` on the `tarea` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(3))` to `VarChar(191)`.

*/
-- AlterTable
ALTER TABLE `departamento` MODIFY `planta` VARCHAR(191) NOT NULL,
    MODIFY `tipo` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `tarea` MODIFY `planta` VARCHAR(191) NOT NULL DEFAULT 'KAPPA';

-- CreateTable
CREATE TABLE `IntervaloTiempo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tareaId` INTEGER NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `estado` ENUM('PENDIENTE', 'ASIGNADA', 'EN_PROGRESO', 'EN_PAUSA', 'RESUELTO', 'CERRADO', 'RECHAZADO', 'CANCELADA') NOT NULL,
    `inicio` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fin` DATETIME(3) NULL,
    `duracion` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `hashedToken` VARCHAR(191) NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IntervaloTiempo` ADD CONSTRAINT `IntervaloTiempo_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `Tarea`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntervaloTiempo` ADD CONSTRAINT `IntervaloTiempo_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
