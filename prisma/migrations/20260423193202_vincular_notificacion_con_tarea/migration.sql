-- CreateIndex
CREATE INDEX `Notificacion_tareaId_idx` ON `Notificacion`(`tareaId`);

-- AddForeignKey
ALTER TABLE `Notificacion` ADD CONSTRAINT `Notificacion_tareaId_fkey` FOREIGN KEY (`tareaId`) REFERENCES `Tarea`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
