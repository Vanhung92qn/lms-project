/*
  Warnings:

  - You are about to drop the column `payment_id` on the `entitlements` table. All the data in the column will be lost.
  - You are about to drop the `payments` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "TopupMethod" AS ENUM ('momo', 'bank');

-- CreateEnum
CREATE TYPE "TopupStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- DropForeignKey
ALTER TABLE "entitlements" DROP CONSTRAINT "entitlements_payment_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_approved_by_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_course_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_user_id_fkey";

-- DropIndex
DROP INDEX "entitlements_payment_id_key";

-- AlterTable
ALTER TABLE "entitlements" DROP COLUMN "payment_id",
ADD COLUMN     "amount_cents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "wallet_balance_cents" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "payments";

-- DropEnum
DROP TYPE "PaymentMethod";

-- DropEnum
DROP TYPE "PaymentStatus";

-- CreateTable
CREATE TABLE "wallet_topups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "method" "TopupMethod" NOT NULL,
    "status" "TopupStatus" NOT NULL DEFAULT 'pending',
    "reference_code" TEXT NOT NULL,
    "user_note" TEXT,
    "admin_note" TEXT,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_topups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_topups_reference_code_key" ON "wallet_topups"("reference_code");

-- CreateIndex
CREATE INDEX "wallet_topups_user_id_created_at_idx" ON "wallet_topups"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_topups_status_created_at_idx" ON "wallet_topups"("status", "created_at");

-- AddForeignKey
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
