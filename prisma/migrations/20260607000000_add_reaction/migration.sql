-- CreateTable: reaction
-- Cascade on both comment and user: reactions are derived interaction state.

CREATE TABLE "reaction" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reaction_comment_id_user_id_type_key" ON "reaction"("comment_id", "user_id", "type");

CREATE INDEX "reaction_comment_id_idx" ON "reaction"("comment_id");

CREATE INDEX "reaction_user_id_idx" ON "reaction"("user_id");

-- AddForeignKey
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_comment_id_fkey"
    FOREIGN KEY ("comment_id") REFERENCES "comment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reaction" ADD CONSTRAINT "reaction_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
