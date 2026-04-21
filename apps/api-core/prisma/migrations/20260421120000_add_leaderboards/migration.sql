-- CreateEnum
CREATE TYPE "LeaderboardScope" AS ENUM ('global', 'course');

-- CreateTable
CREATE TABLE "leaderboards" (
    "id" UUID NOT NULL,
    "scope" "LeaderboardScope" NOT NULL,
    "title" TEXT NOT NULL,
    "course_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leaderboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_entries" (
    "leaderboard_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "solved_count" INTEGER NOT NULL DEFAULT 0,
    "penalty_seconds" INTEGER NOT NULL DEFAULT 0,
    "last_submission_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leaderboard_entries_pkey" PRIMARY KEY ("leaderboard_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leaderboards_scope_course_id_key" ON "leaderboards"("scope", "course_id");

-- CreateIndex
CREATE INDEX "leaderboards_scope_idx" ON "leaderboards"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_entries_leaderboard_id_rank_key" ON "leaderboard_entries"("leaderboard_id", "rank");

-- CreateIndex
CREATE INDEX "leaderboard_entries_leaderboard_id_rank_idx" ON "leaderboard_entries"("leaderboard_id", "rank");

-- CreateIndex
CREATE INDEX "leaderboard_entries_leaderboard_id_score_penalty_seconds_last_submission_at_idx" ON "leaderboard_entries"("leaderboard_id", "score" DESC, "penalty_seconds", "last_submission_at");

-- AddForeignKey
ALTER TABLE "leaderboards" ADD CONSTRAINT "leaderboards_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_leaderboard_id_fkey" FOREIGN KEY ("leaderboard_id") REFERENCES "leaderboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
