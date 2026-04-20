-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('pending', 'ac', 'wa', 'tle', 'mle', 'ce', 're', 'ie');

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "source_code" TEXT NOT NULL,
    "language" "CodeLanguage" NOT NULL,
    "verdict" "Verdict" NOT NULL DEFAULT 'pending',
    "runtime_ms" INTEGER,
    "memory_kb" INTEGER,
    "stderr" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_test_results" (
    "submission_id" UUID NOT NULL,
    "test_case_id" UUID NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "verdict" "Verdict" NOT NULL DEFAULT 'pending',
    "actual_output" TEXT,
    "runtime_ms" INTEGER,

    CONSTRAINT "submission_test_results_pkey" PRIMARY KEY ("submission_id","test_case_id")
);

-- CreateIndex
CREATE INDEX "submissions_user_id_exercise_id_created_at_idx" ON "submissions"("user_id", "exercise_id", "created_at");

-- CreateIndex
CREATE INDEX "submissions_exercise_id_verdict_idx" ON "submissions"("exercise_id", "verdict");

-- CreateIndex
CREATE INDEX "submission_test_results_submission_id_idx" ON "submission_test_results"("submission_id");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_test_results" ADD CONSTRAINT "submission_test_results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_test_results" ADD CONSTRAINT "submission_test_results_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "test_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
