-- Adiciona suporte ao token de autorizacao de jobs emitido pelo Acessilia Core (capability token)
ALTER TABLE processing_jobs ADD COLUMN job_token TEXT;
