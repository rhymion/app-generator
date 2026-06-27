-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "encrypted_original_name" TEXT,
ADD COLUMN     "name_iv" TEXT;
