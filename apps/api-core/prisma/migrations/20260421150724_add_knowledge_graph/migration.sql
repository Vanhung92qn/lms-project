-- CreateEnum
CREATE TYPE "KnowledgeRelation" AS ENUM ('prereq', 'related');

-- CreateTable
CREATE TABLE "knowledge_nodes" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_edges" (
    "id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "to_id" UUID NOT NULL,
    "weight" DECIMAL(4,3) NOT NULL DEFAULT 1.0,
    "relation" "KnowledgeRelation" NOT NULL DEFAULT 'prereq',

    CONSTRAINT "knowledge_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_knowledge_nodes" (
    "lesson_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,

    CONSTRAINT "lesson_knowledge_nodes_pkey" PRIMARY KEY ("lesson_id","node_id")
);

-- CreateTable
CREATE TABLE "user_mastery" (
    "user_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "score" DECIMAL(4,3) NOT NULL DEFAULT 0.1,
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mastery_pkey" PRIMARY KEY ("user_id","node_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_nodes_slug_key" ON "knowledge_nodes"("slug");

-- CreateIndex
CREATE INDEX "knowledge_nodes_domain_idx" ON "knowledge_nodes"("domain");

-- CreateIndex
CREATE INDEX "knowledge_edges_to_id_idx" ON "knowledge_edges"("to_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_edges_from_id_to_id_relation_key" ON "knowledge_edges"("from_id", "to_id", "relation");

-- CreateIndex
CREATE INDEX "lesson_knowledge_nodes_node_id_idx" ON "lesson_knowledge_nodes"("node_id");

-- CreateIndex
CREATE INDEX "user_mastery_user_id_score_idx" ON "user_mastery"("user_id", "score");

-- AddForeignKey
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_knowledge_nodes" ADD CONSTRAINT "lesson_knowledge_nodes_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_knowledge_nodes" ADD CONSTRAINT "lesson_knowledge_nodes_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mastery" ADD CONSTRAINT "user_mastery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mastery" ADD CONSTRAINT "user_mastery_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
