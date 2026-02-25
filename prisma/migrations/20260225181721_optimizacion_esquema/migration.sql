-- AlterTable
ALTER TABLE `tarea` MODIFY `titulo` VARCHAR(255) NOT NULL;

-- CreateIndex
CREATE INDEX `Tarea_departamentoId_estado_idx` ON `Tarea`(`departamentoId`, `estado`);

-- CreateIndex
CREATE INDEX `Tarea_creadorId_createdAt_idx` ON `Tarea`(`creadorId`, `createdAt`);
