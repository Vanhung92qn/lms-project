-- CreateTable
CREATE TABLE "onboarding_profiles" (
    "user_id" UUID NOT NULL,
    "goals" JSONB NOT NULL,
    "level" TEXT NOT NULL,
    "weekly_hours" TEXT NOT NULL,
    "known_languages" JSONB NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_profiles_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "onboarding_profiles" ADD CONSTRAINT "onboarding_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
