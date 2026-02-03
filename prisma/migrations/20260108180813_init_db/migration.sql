/*
  Warnings:

  - You are about to drop the column `creadoEn` on the `usuario` table. All the data in the column will be lost.
  - You are about to alter the column `rol` on the `usuario` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(0))` to `Enum(EnumId(1))`.
  - You are about to drop the `mantenimiento` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `maquina` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `updatedAt` to the `Usuario` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `mantenimiento` DROP FOREIGN KEY `Mantenimiento_maquinaId_fkey`;

-- DropForeignKey
ALTER TABLE `mantenimiento` DROP FOREIGN KEY `Mantenimiento_usuarioId_fkey`;

-- AlterTable
ALTER TABLE `usuario` DROP COLUMN `creadoEn`,
    ADD COLUMN `cargo` VARCHAR(191) NULL,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `departamentoId` INTEGER NULL,
    ADD COLUMN `estado` ENUM('ACTIVO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO',
    ADD COLUMN `numNomina` VARCHAR(191) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL,
    MODIFY `rol` ENUM('CLIENTE_INTERNO', 'TECNICO', 'COORDINADOR_MTTO', 'JEFE_MTTO', 'SUPER_ADMIN') NOT NULL DEFAULT 'CLIENTE_INTERNO';

-- DropTable
DROP TABLE `mantenimiento`;

-- DropTable
DROP TABLE `maquina`;

-- CreateTable
CREATE TABLE `Departamento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(191) NOT NULL,
    `estado` ENUM('ACTIVO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Departamento_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tarea` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `titulo` VARCHAR(191) NOT NULL,
    `categoria` VARCHAR(191) NULL,
    `descripcion` TEXT NOT NULL,
    `planta` VARCHAR(191) NOT NULL,
    `area` VARCHAR(191) NOT NULL,
    `prioridad` ENUM('BAJA', 'MEDIA', 'ALTA', 'CRITICA') NOT NULL DEFAULT 'MEDIA',
    `estado` ENUM('PENDIENTE', 'ASIGNADA', 'EN_PROGRESO', 'EN_PAUSA', 'RESUELTO', 'CERRADO', 'RECHAZADO', 'CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
    `fechaVencimiento` DATETIME(3) NULL,
    `creadorId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `finalizadoAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Imagen` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `url` VARCHAR(191) NOT NULL,
    `tareaId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_Responsables` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_Responsables_AB_unique`(`A`, `B`),
    INDEX `_Responsables_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Usuario` ADD CONSTRAINT `Usuario_departamentoId_fkey` FOREIGN KEY (`departamentoId`) REFERENCES `Departamento`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tarea` ADD CONSTRAINT `Tarea_creadorId_fkey` FOREIGN KEY (`creadorId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Imagen` ADD CONSTRAINT `Imagen_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `Tarea`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_Responsables` ADD CONSTRAINT `_Responsables_A_fkey` FOREIGN KEY (`A`) REFERENCES `Tarea`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_Responsables` ADD CONSTRAINT `_Responsables_B_fkey` FOREIGN KEY (`B`) REFERENCES `Usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
