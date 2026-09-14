-- Migracao 002: Suporte a Agendamento, Alt Texts e Feedback Discente
-- Acessilia Gestor UFG

-- 1. Coluna de Agendamento em Materiais
ALTER TABLE materials ADD COLUMN publish_at TEXT NULL;

-- 2. Descricoes de Imagens / Figuras (Alt Text Review)
CREATE TABLE IF NOT EXISTS material_alt_texts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_version_id INTEGER NOT NULL REFERENCES material_versions(id) ON DELETE CASCADE,
    image_url_or_path TEXT NOT NULL,
    ai_suggested_alt TEXT NOT NULL,
    human_reviewed_alt TEXT NULL,
    status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'APROVADO', 'MODIFICADO')),
    reviewed_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Canal de Feedback de Acessibilidade Discente
CREATE TABLE IF NOT EXISTS material_feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    issue_type TEXT NOT NULL CHECK (issue_type IN ('FORMULA', 'IMAGEM_ALT', 'TABELA', 'AUDIO_SINTESE', 'OUTRO')),
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO', 'EM_ANALISE', 'RESOLVIDO')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
