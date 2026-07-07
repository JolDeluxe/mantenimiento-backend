-- AlterTable
ALTER TABLE `Tarea` ADD COLUMN `fechaCicloLogica` DATETIME(3) NULL,
    ADD COLUMN `reglaRecurrenciaId` INTEGER NULL;

-- CreateTable
CREATE TABLE `ReglaRecurrencia` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `maquinaId` INTEGER NOT NULL,
    `titulo` VARCHAR(255) NOT NULL,
    `descripcion` TEXT NULL,
    `categoria` VARCHAR(100) NOT NULL DEFAULT 'MAQUINARIA',
    `prioridad` ENUM('BAJA', 'MEDIA', 'ALTA', 'CRITICA') NOT NULL DEFAULT 'MEDIA',
    `tiempoEstimado` INTEGER NULL,
    `frecuencia` ENUM('SEMANAL', 'QUINCENAL', 'MENSUAL', 'PERSONALIZADA_DIAS') NOT NULL,
    `intervaloDias` INTEGER NULL,
    `tecnicoResponsableId` INTEGER NOT NULL,
    `proximaFechaEjecucion` DATETIME(3) NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReglaRecurrencia_maquinaId_idx`(`maquinaId`),
    INDEX `ReglaRecurrencia_tecnicoResponsableId_idx`(`tecnicoResponsableId`),
    INDEX `ReglaRecurrencia_proximaFechaEjecucion_activo_idx`(`proximaFechaEjecucion`, `activo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Tarea_reglaRecurrenciaId_fechaCicloLogica_idx` ON `Tarea`(`reglaRecurrenciaId`, `fechaCicloLogica`);

-- CreateIndex
CREATE UNIQUE INDEX `Tarea_reglaRecurrenciaId_fechaCicloLogica_key` ON `Tarea`(`reglaRecurrenciaId`, `fechaCicloLogica`);

-- AddForeignKey
ALTER TABLE `Tarea` ADD CONSTRAINT `Tarea_reglaRecurrenciaId_fkey` FOREIGN KEY (`reglaRecurrenciaId`) REFERENCES `ReglaRecurrencia`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReglaRecurrencia` ADD CONSTRAINT `ReglaRecurrencia_maquinaId_fkey` FOREIGN KEY (`maquinaId`) REFERENCES `Maquina`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReglaRecurrencia` ADD CONSTRAINT `ReglaRecurrencia_tecnicoResponsableId_fkey` FOREIGN KEY (`tecnicoResponsableId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
