
-- DropForeignKey
ALTER TABLE "public"."note" DROP CONSTRAINT "note_noteable_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."product" DROP CONSTRAINT "product_noteable_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."resource" DROP CONSTRAINT "resource_noteable_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."room" DROP CONSTRAINT "room_noteable_id_fkey";

-- DropIndex
DROP INDEX "public"."product_noteable_id_key";

-- DropIndex
DROP INDEX "public"."resource_noteable_id_key";

-- DropIndex
DROP INDEX "public"."room_noteable_id_key";

-- AlterTable
ALTER TABLE "public"."inventory_allocation" ADD COLUMN     "remaining_quantity" INTEGER NOT NULL,
ADD COLUMN     "status" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "public"."note" DROP COLUMN "noteable_id";

-- AlterTable
ALTER TABLE "public"."product" DROP COLUMN "noteable_id";

-- AlterTable
ALTER TABLE "public"."resource" DROP COLUMN "noteable_id";

-- AlterTable
ALTER TABLE "public"."room" DROP COLUMN "noteable_id";

-- DropTable
DROP TABLE "public"."noteable";

-- CreateTable
CREATE TABLE "public"."receiving_asn" (
    "id" TEXT NOT NULL,
    "asn_no" TEXT NOT NULL,
    "purchase_order_id" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,
    "creator_id" TEXT NOT NULL,
    "updater_id" TEXT NOT NULL,

    CONSTRAINT "receiving_asn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receiving_asn_line" (
    "id" TEXT NOT NULL,
    "receiving_asn_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "shipped_quantity" INTEGER NOT NULL,
    "done_quantity" INTEGER NOT NULL DEFAULT 0,
    "cancelled_quantity" INTEGER NOT NULL DEFAULT 0,
    "outstanding_quantity" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,

    CONSTRAINT "receiving_asn_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receiving_purchase_order" (
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,
    "creator_id" TEXT NOT NULL,
    "updater_id" TEXT NOT NULL,

    CONSTRAINT "receiving_purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receiving_purchase_order_line" (
    "id" TEXT NOT NULL,
    "receiving_purchase_order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "ordered_quantity" INTEGER NOT NULL,
    "done_quantity" INTEGER NOT NULL DEFAULT 0,
    "cancelled_quantity" INTEGER NOT NULL DEFAULT 0,
    "outstanding_quantity" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,

    CONSTRAINT "receiving_purchase_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receiving_receipt" (
    "id" TEXT NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "purchase_order_id" TEXT,
    "asn_id" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "confirmed_at" TIMESTAMPTZ(0),
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,
    "creator_id" TEXT NOT NULL,
    "updater_id" TEXT NOT NULL,

    CONSTRAINT "receiving_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receiving_receipt_line" (
    "id" TEXT NOT NULL,
    "receiving_receipt_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "receipt_quantity" INTEGER NOT NULL,
    "done_quantity" INTEGER NOT NULL DEFAULT 0,
    "cancelled_quantity" INTEGER NOT NULL DEFAULT 0,
    "outstanding_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,

    CONSTRAINT "receiving_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receiving_asn_creator_id_idx" ON "public"."receiving_asn"("creator_id" ASC);

-- CreateIndex
CREATE INDEX "receiving_asn_purchase_order_id_idx" ON "public"."receiving_asn"("purchase_order_id" ASC);

-- CreateIndex
CREATE INDEX "receiving_asn_line_receiving_asn_id_idx" ON "public"."receiving_asn_line"("receiving_asn_id" ASC);

-- CreateIndex
CREATE INDEX "receiving_purchase_order_creator_id_idx" ON "public"."receiving_purchase_order"("creator_id" ASC);

-- CreateIndex
CREATE INDEX "receiving_purchase_order_line_receiving_purchase_order_id_idx" ON "public"."receiving_purchase_order_line"("receiving_purchase_order_id" ASC);

-- CreateIndex
CREATE INDEX "receiving_receipt_asn_id_idx" ON "public"."receiving_receipt"("asn_id" ASC);

-- CreateIndex
CREATE INDEX "receiving_receipt_creator_id_idx" ON "public"."receiving_receipt"("creator_id" ASC);

-- CreateIndex
CREATE INDEX "receiving_receipt_purchase_order_id_idx" ON "public"."receiving_receipt"("purchase_order_id" ASC);

-- CreateIndex
CREATE INDEX "receiving_receipt_line_receiving_receipt_id_idx" ON "public"."receiving_receipt_line"("receiving_receipt_id" ASC);

-- AddForeignKey
ALTER TABLE "public"."receiving_asn" ADD CONSTRAINT "receiving_asn_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_asn" ADD CONSTRAINT "receiving_asn_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."receiving_purchase_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_asn" ADD CONSTRAINT "receiving_asn_updater_id_fkey" FOREIGN KEY ("updater_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_asn_line" ADD CONSTRAINT "receiving_asn_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_asn_line" ADD CONSTRAINT "receiving_asn_line_receiving_asn_id_fkey" FOREIGN KEY ("receiving_asn_id") REFERENCES "public"."receiving_asn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_purchase_order" ADD CONSTRAINT "receiving_purchase_order_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_purchase_order" ADD CONSTRAINT "receiving_purchase_order_updater_id_fkey" FOREIGN KEY ("updater_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_purchase_order_line" ADD CONSTRAINT "receiving_purchase_order_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_purchase_order_line" ADD CONSTRAINT "receiving_purchase_order_line_receiving_purchase_order_id_fkey" FOREIGN KEY ("receiving_purchase_order_id") REFERENCES "public"."receiving_purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_receipt" ADD CONSTRAINT "receiving_receipt_asn_id_fkey" FOREIGN KEY ("asn_id") REFERENCES "public"."receiving_asn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_receipt" ADD CONSTRAINT "receiving_receipt_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_receipt" ADD CONSTRAINT "receiving_receipt_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."receiving_purchase_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_receipt" ADD CONSTRAINT "receiving_receipt_updater_id_fkey" FOREIGN KEY ("updater_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_receipt_line" ADD CONSTRAINT "receiving_receipt_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receiving_receipt_line" ADD CONSTRAINT "receiving_receipt_line_receiving_receipt_id_fkey" FOREIGN KEY ("receiving_receipt_id") REFERENCES "public"."receiving_receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

