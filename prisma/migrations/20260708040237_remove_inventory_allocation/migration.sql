-- DropForeignKey
ALTER TABLE "inventory_allocation" DROP CONSTRAINT "inventory_allocation_creator_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_allocation" DROP CONSTRAINT "inventory_allocation_inventory_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_allocation" DROP CONSTRAINT "inventory_allocation_purchase_order_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_allocation" DROP CONSTRAINT "inventory_allocation_purchase_per_item_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory_allocation" DROP CONSTRAINT "inventory_allocation_updater_id_fkey";

-- DropTable
DROP TABLE "inventory_allocation";
