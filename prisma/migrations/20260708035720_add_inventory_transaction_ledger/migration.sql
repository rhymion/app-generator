-- AlterTable
ALTER TABLE "approvable" ADD COLUMN     "rejection_reason" TEXT;

-- AlterTable
ALTER TABLE "purchase_per_item" ADD COLUMN     "approvable_id" TEXT,
ADD COLUMN     "inventory_transactionable_id" TEXT;

-- AlterTable
ALTER TABLE "receiving_receipt_line" ADD COLUMN     "approvable_id" TEXT,
ADD COLUMN     "inventory_id" TEXT,
ADD COLUMN     "inventory_transactionable_id" TEXT,
ADD COLUMN     "is_split_result" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parent_id" TEXT,
ADD COLUMN     "status" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "inventory_transactionable" (
    "id" TEXT NOT NULL,

    CONSTRAINT "inventory_transactionable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transaction" (
    "id" TEXT NOT NULL,
    "inventory_transactionable_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reserved_delta" INTEGER NOT NULL,
    "product_id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "lot_number" TEXT,
    "expiration_date" TIMESTAMPTZ(0),
    "approved_via" TEXT,
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(0) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "updater_id" TEXT NOT NULL,

    CONSTRAINT "inventory_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_transaction_inventory_transactionable_id_idx" ON "inventory_transaction"("inventory_transactionable_id");

-- CreateIndex
CREATE INDEX "inventory_transaction_created_by_id_idx" ON "inventory_transaction"("created_by_id");

-- CreateIndex
CREATE INDEX "inventory_transaction_creator_id_idx" ON "inventory_transaction"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_per_item_approvable_id_key" ON "purchase_per_item"("approvable_id");

-- CreateIndex
CREATE UNIQUE INDEX "receiving_receipt_line_approvable_id_key" ON "receiving_receipt_line"("approvable_id");

-- CreateIndex
CREATE INDEX "receiving_receipt_line_inventory_id_idx" ON "receiving_receipt_line"("inventory_id");

-- CreateIndex
CREATE INDEX "receiving_receipt_line_parent_id_idx" ON "receiving_receipt_line"("parent_id");

-- AddForeignKey
ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_inventory_transactionable_id_fkey" FOREIGN KEY ("inventory_transactionable_id") REFERENCES "inventory_transactionable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_updater_id_fkey" FOREIGN KEY ("updater_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_per_item" ADD CONSTRAINT "purchase_per_item_approvable_id_fkey" FOREIGN KEY ("approvable_id") REFERENCES "approvable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_per_item" ADD CONSTRAINT "purchase_per_item_inventory_transactionable_id_fkey" FOREIGN KEY ("inventory_transactionable_id") REFERENCES "inventory_transactionable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_receipt_line" ADD CONSTRAINT "receiving_receipt_line_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_receipt_line" ADD CONSTRAINT "receiving_receipt_line_approvable_id_fkey" FOREIGN KEY ("approvable_id") REFERENCES "approvable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_receipt_line" ADD CONSTRAINT "receiving_receipt_line_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "receiving_receipt_line"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "receiving_receipt_line" ADD CONSTRAINT "receiving_receipt_line_inventory_transactionable_id_fkey" FOREIGN KEY ("inventory_transactionable_id") REFERENCES "inventory_transactionable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
