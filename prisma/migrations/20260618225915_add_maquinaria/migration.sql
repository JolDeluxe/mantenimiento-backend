-- AlterTable
ALTER TABLE `tarea` ADD COLUMN `impactoProduccion` INTEGER NULL,
    ADD COLUMN `maquinaId` INTEGER NULL,
    ADD COLUMN `paroProduccion` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `Maquina` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(50) NOT NULL,
    `nombre` VARCHAR(255) NOT NULL,
    `proceso` VARCHAR(150) NOT NULL,
    `descripcion` TEXT NULL,
    `imagen` VARCHAR(255) NULL,
    `criticidad` ENUM('A', 'B', 'C') NOT NULL DEFAULT 'C',
    `estado` ENUM('OPERATIVA', 'EN_REPARACION', 'INACTIVA', 'BAJA') NOT NULL DEFAULT 'OPERATIVA',
    `marca` VARCHAR(100) NULL,
    `modelo` VARCHAR(100) NULL,
    `numeroSerie` VARCHAR(100) NULL,
    `planta` VARCHAR(100) NOT NULL,
    `area` VARCHAR(100) NOT NULL,
    `ubicacionDetalle` VARCHAR(255) NULL,
    `fechaInstalacion` DATETIME(3) NULL,
    `fechaUltimoServicio` DATETIME(3) NULL,
    `departamentoId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Maquina_codigo_key`(`codigo`),
    UNIQUE INDEX `Maquina_numeroSerie_key`(`numeroSerie`),
    INDEX `Maquina_codigo_idx`(`codigo`),
    INDEX `Maquina_estado_idx`(`estado`),
    INDEX `Maquina_planta_area_idx`(`planta`, `area`),
    INDEX `Maquina_proceso_idx`(`proceso`),
    INDEX `Maquina_criticidad_idx`(`criticidad`),
    INDEX `Maquina_departamentoId_idx`(`departamentoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Tarea_maquinaId_idx` ON `Tarea`(`maquinaId`);

-- CreateIndex
CREATE INDEX `Tarea_maquinaId_estado_idx` ON `Tarea`(`maquinaId`, `estado`);

-- AddForeignKey
ALTER TABLE `Tarea` ADD CONSTRAINT `Tarea_maquinaId_fkey` FOREIGN KEY (`maquinaId`) REFERENCES `Maquina`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Maquina` ADD CONSTRAINT `Maquina_departamentoId_fkey` FOREIGN KEY (`departamentoId`) REFERENCES `Departamento`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
