
CREATE POLICY "library_read_own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'library' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "library_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'library' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "library_delete_own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'library' AND auth.uid()::text = (storage.foldername(name))[1]);
