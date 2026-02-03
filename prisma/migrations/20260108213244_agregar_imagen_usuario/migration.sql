/*
  Warnings:

  - A unique constraint covering the columns `[username]` on the table `Usuario` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `username` to the `Usuario` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `usuario` ADD COLUMN `imagen` VARCHAR(191) NULL,
    ADD COLUMN `username` VARCHAR(191) NOT NULL,
    MODIFY `email` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Usuario_username_key` ON `Usuario`(`username`);
