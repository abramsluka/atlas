CREATE TABLE IF NOT EXISTS subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  amount         numeric(10,2) NOT NULL,
  currency       text NOT NULL DEFAULT 'USD',
  billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('weekly', 'monthly', 'yearly')),
  next_renewal   date,
  auto_renews    boolean NOT NULL DEFAULT true,
  category       text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'Users can manage their own subscriptions'
  ) THEN
    CREATE POLICY "Users can manage their own subscriptions"
      ON subscriptions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_renewal ON subscriptions(user_id, next_renewal);
