
-- Add columns for resource completion tracking and user notes per module
ALTER TABLE public.progress
ADD COLUMN completed_resources text[] DEFAULT '{}',
ADD COLUMN notes text DEFAULT '';
