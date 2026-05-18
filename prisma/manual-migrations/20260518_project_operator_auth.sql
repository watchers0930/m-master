-- CreateTable
CREATE TABLE "ProjectOperator" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "accessKeyHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectOperator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectOperatorSession" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectOperatorSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOperator_projectId_name_key" ON "ProjectOperator"("projectId", "name");

-- CreateIndex
CREATE INDEX "ProjectOperator_projectId_active_role_idx" ON "ProjectOperator"("projectId", "active", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOperatorSession_tokenHash_key" ON "ProjectOperatorSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ProjectOperatorSession_operatorId_expiresAt_idx" ON "ProjectOperatorSession"("operatorId", "expiresAt");

-- AddForeignKey
ALTER TABLE "ProjectOperator" ADD CONSTRAINT "ProjectOperator_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOperatorSession" ADD CONSTRAINT "ProjectOperatorSession_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ProjectOperator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
