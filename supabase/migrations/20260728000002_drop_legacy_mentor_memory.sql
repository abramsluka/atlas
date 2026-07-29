-- ============================================================
-- Retire the pre-facts memory layer.
--
-- Runs after 20260728000001 and after scripts/seed-profile-facts.ts has
-- decomposed about_me into user_profile_facts rows.
--
-- mentor_memories: rolling conversation summaries. Identity content now lives
-- in user_profile_facts; conversational recency comes from mentor_conversations
-- / mentor_messages, which already store the full transcripts.
--
-- mentor_context.about_me: the full-document-rewrite profile blob.
-- mentor_context itself stays — primary_goal, goal_last_comment, and
-- last_consolidated_at are all still live.
-- ============================================================

drop table if exists mentor_memories;

alter table mentor_context drop column if exists about_me;
