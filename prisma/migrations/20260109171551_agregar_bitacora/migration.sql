-- CreateTable
CREATE TABLE `Bitacora` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accion` VARCHAR(191) NOT NULL,
    `detalles` VARCHAR(191) NULL,
    `usuarioId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Bitacora` ADD CONSTRAINT `Bitacora_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
