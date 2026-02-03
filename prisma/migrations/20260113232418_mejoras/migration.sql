-- AlterTable
ALTER TABLE `bitacora` MODIFY `detalles` TEXT NULL;

-- AlterTable
ALTER TABLE `imagen` ADD COLUMN `tipo` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `tarea` ADD COLUMN `fechaInicio` DATETIME(3) NULL,
    ADD COLUMN `motivoPausa` TEXT NULL,
    ADD COLUMN `motivoRechazo` TEXT NULL,
    ADD COLUMN `notasCierre` TEXT NULL;
