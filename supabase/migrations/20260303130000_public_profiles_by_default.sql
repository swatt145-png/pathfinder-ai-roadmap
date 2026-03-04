-- Make profiles public by default (LinkedIn-style discoverability)
-- Roadmap details are still gated behind connection status in the UI
-- Only show email-verified users in Community (exclude anonymous/guest accounts)

-- Update default for new profiles
ALTER TABLE public.profiles ALTER COLUMN is_public SET DEFAULT true;

-- Make all existing profiles public
UPDATE public.profiles SET is_public = true WHERE is_public = false;

-- Add is_email_user flag to distinguish real accounts from guests
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_email_user boolean NOT NULL DEFAULT false;

-- Mark existing email users (have email in auth.users)
UPDATE public.profiles p
SET is_email_user = true
WHERE EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id = p.id AND u.email IS NOT NULL
);

-- Update the signup trigger to set is_email_user automatically
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, is_email_user)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'User'),
    NEW.email IS NOT NULL
  );
  RETURN NEW;
END;
$$;
