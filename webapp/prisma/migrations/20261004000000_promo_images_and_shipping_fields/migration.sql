-- AlterTable
ALTER TABLE "User" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "User" ADD COLUMN "shippingRecipientName" TEXT;

-- AlterTable
ALTER TABLE "PromoItem" ADD COLUMN "imageUrl2" TEXT;
ALTER TABLE "PromoItem" ADD COLUMN "imageUrl3" TEXT;

-- AlterTable
ALTER TABLE "PromoRedemption" ADD COLUMN "shippingPostalCode" TEXT;
ALTER TABLE "PromoRedemption" ADD COLUMN "shippingRecipientName" TEXT;
