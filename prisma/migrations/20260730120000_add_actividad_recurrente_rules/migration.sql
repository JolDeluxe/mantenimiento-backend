-- CreateTable
CREATE TABLE `ReglaActividadRecurrente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `titulo` VARCHAR(255) NOT NULL,
    `descripcion` TEXT NULL,
    `categoria` VARCHAR(191) NOT NULL,
    `planta` VARCHAR(191) NULL,
    `area` VARCHAR(191) NOT NULL,
    `prioridad` ENUM('BAJA', 'MEDIA', 'ALTA', 'CRITICA') NOT NULL DEFAULT 'MEDIA',
    `fechaInicio` DATETIME(3) NOT NULL,
    `fechaFin` DATETIME(3) NULL,
    `horaInicioMinutos` INTEGER NULL,
    `horaFinMinutos` INTEGER NULL,
    `tiempoEstimado` INTEGER NULL,
    `unidad` ENUM('DIA', 'SEMANA', 'MES') NOT NULL,
    `intervalo` INTEGER NOT NULL DEFAULT 1,
    `proximaFechaEjecucion` DATETIME(3) NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `archivadoAt` DATETIME(3) NULL,
    `creadorId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReglaActividadRecurrente_archivadoAt_activo_proximaFechaEjec_idx`(`archivadoAt`, `activo`, `proximaFechaEjecucion`),
    INDEX `ReglaActividadRecurrente_planta_area_idx`(`planta`, `area`),
    INDEX `ReglaActividadRecurrente_categoria_idx`(`categoria`),
    INDEX `ReglaActividadRecurrente_creadorId_idx`(`creadorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReglaActividadRecurrenteAjuste` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reglaActividadRecurrenteId` INTEGER NOT NULL,
    `fechaOriginal` DATETIME(3) NOT NULL,
    `tipo` ENUM('MOVER', 'OMITIR') NOT NULL,
    `fechaNueva` DATETIME(3) NULL,
    `motivo` TEXT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReglaActividadRecurrenteAjuste_reglaActividadRecurrenteId_ac_idx`(`reglaActividadRecurrenteId`, `activo`, `fechaOriginal`),
    INDEX `ReglaActividadRecurrenteAjuste_createdById_idx`(`createdById`),
    UNIQUE INDEX `ReglaActividadRecurrenteAjuste_reglaActividadRecurrenteId_fe_key`(`reglaActividadRecurrenteId`, `fechaOriginal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_ReglaActividadResponsables` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_ReglaActividadResponsables_AB_unique`(`A`, `B`),
    INDEX `_ReglaActividadResponsables_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Tarea` ADD COLUMN `reglaActividadRecurrenteId` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Tarea_reglaActividadRecurrenteId_fechaCicloLogica_key` ON `Tarea`(`reglaActividadRecurrenteId`, `fechaCicloLogica`);

-- AddForeignKey
ALTER TABLE `Tarea` ADD CONSTRAINT `Tarea_reglaActividadRecurrenteId_fkey` FOREIGN KEY (`reglaActividadRecurrenteId`) REFERENCES `ReglaActividadRecurrente`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReglaActividadRecurrente` ADD CONSTRAINT `ReglaActividadRecurrente_creadorId_fkey` FOREIGN KEY (`creadorId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReglaActividadRecurrenteAjuste` ADD CONSTRAINT `ReglaActividadRecurrenteAjuste_reglaActividadRecurrenteId_fkey` FOREIGN KEY (`reglaActividadRecurrenteId`) REFERENCES `ReglaActividadRecurrente`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReglaActividadRecurrenteAjuste` ADD CONSTRAINT `ReglaActividadRecurrenteAjuste_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ReglaActividadResponsables` ADD CONSTRAINT `_ReglaActividadResponsables_A_fkey` FOREIGN KEY (`A`) REFERENCES `ReglaActividadRecurrente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ReglaActividadResponsables` ADD CONSTRAINT `_ReglaActividadResponsables_B_fkey` FOREIGN KEY (`B`) REFERENCES `Usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
