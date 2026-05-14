-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "analyticsAccessKey" TEXT,
ADD COLUMN     "analyticsConnectedAt" TIMESTAMP(3),
ADD COLUMN     "analyticsEndpointUrl" TEXT,
ADD COLUMN     "analyticsSourceId" TEXT,
ADD COLUMN     "analyticsSourceLabel" TEXT,
ADD COLUMN     "analyticsSourceType" TEXT;

-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "basisSummary" TEXT,
    "autoGenerate" BOOLEAN NOT NULL DEFAULT false,
    "generatedAt" TIMESTAMP(3),
    "lastExecutedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPlanItem" (
    "id" TEXT NOT NULL,
    "contentPlanId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "weekLabel" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "intentType" TEXT,
    "objective" TEXT,
    "rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "contentJobId" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentPlan_projectId_monthKey_idx" ON "ContentPlan"("projectId", "monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPlan_projectId_monthKey_key" ON "ContentPlan"("projectId", "monthKey");

-- CreateIndex
CREATE INDEX "ContentPlanItem_contentPlanId_sortOrder_idx" ON "ContentPlanItem"("contentPlanId", "sortOrder");

-- CreateIndex
CREATE INDEX "ContentPlanItem_contentPlanId_status_idx" ON "ContentPlanItem"("contentPlanId", "status");

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanItem" ADD CONSTRAINT "ContentPlanItem_contentPlanId_fkey" FOREIGN KEY ("contentPlanId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
