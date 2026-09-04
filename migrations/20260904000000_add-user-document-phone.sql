-- Add document and phone fields to users_global
ALTER TABLE public.users_global ADD COLUMN IF NOT EXISTS document_type varchar(20) CHECK (document_type IN ('DNI', 'CE', 'PASAPORTE'));
ALTER TABLE public.users_global ADD COLUMN IF NOT EXISTS document_number varchar(30);
ALTER TABLE public.users_global ADD COLUMN IF NOT EXISTS phone varchar(30);
