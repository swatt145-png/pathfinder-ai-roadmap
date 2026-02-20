
-- Create storage bucket for topic images
INSERT INTO storage.buckets (id, name, public) VALUES ('topic-images', 'topic-images', true);

-- Allow public read access
CREATE POLICY "Topic images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'topic-images');

-- Allow service role to upload (edge functions use service role)
CREATE POLICY "Service role can upload topic images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'topic-images');

CREATE POLICY "Service role can update topic images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'topic-images');
