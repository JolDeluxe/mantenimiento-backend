-- CreateTable
CREATE TABLE `ConfiguracionSistema` (
    `id` VARCHAR(191) NOT NULL,
    `clave` VARCHAR(100) NOT NULL,
    `valor` TEXT NOT NULL,
    `descripcion` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ConfiguracionSistema_clave_key`(`clave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlantillaRevision` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(255) NOT NULL,
    `descripcion` TEXT NULL,
    `aplicaA` ENUM('AUTONOMO', 'PREVENTIVO', 'AMBOS') NOT NULL DEFAULT 'AUTONOMO',
    `contenido` JSON NOT NULL,
    `activa` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlantillaRevisionMaquina` (
    `plantillaId` INTEGER NOT NULL,
    `maquinaId` INTEGER NOT NULL,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `activa` BOOLEAN NOT NULL DEFAULT true,

    INDEX `PlantillaRevisionMaquina_maquinaId_activa_idx`(`maquinaId`, `activa`),
    PRIMARY KEY (`plantillaId`, `maquinaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlantillaRevisionMaquina` ADD CONSTRAINT `PlantillaRevisionMaquina_plantillaId_fkey` FOREIGN KEY (`plantillaId`) REFERENCES `PlantillaRevision`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlantillaRevisionMaquina` ADD CONSTRAINT `PlantillaRevisionMaquina_maquinaId_fkey` FOREIGN KEY (`maquinaId`) REFERENCES `Maquina`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default feature flag
INSERT INTO `ConfiguracionSistema` (`id`, `clave`, `valor`, `descripcion`, `createdAt`, `updatedAt`)
VALUES ('8f1b219e-e8b2-4d2c-80a5-b1a9e320473e', 'AUTONOMOS_HABILITADOS', 'false', 'Flag global para habilitar mantenimientos autónomos en portal público', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
