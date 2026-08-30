CREATE POLICY "library_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'library' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'library' AND (storage.foldername(name))[1] = auth.uid()::text);