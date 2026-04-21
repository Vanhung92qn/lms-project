-- AlterTable
ALTER TABLE "exercises" ADD COLUMN     "is_challenge" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "lesson_completions" (
    "user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'mark',
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_completions_pkey" PRIMARY KEY ("user_id","lesson_id")
);

-- CreateIndex
CREATE INDEX "lesson_completions_lesson_id_idx" ON "lesson_completions"("lesson_id");

-- CreateIndex
CREATE INDEX "exercises_is_challenge_idx" ON "exercises"("is_challenge");

-- AddForeignKey
ALTER TABLE "lesson_completions" ADD CONSTRAINT "lesson_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_completions" ADD CONSTRAINT "lesson_completions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
