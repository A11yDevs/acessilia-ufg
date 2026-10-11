-- Migração 003: Suporte ao status FALHA_PROCESSAMENTO em materials
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS materials_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    class_id INTEGER NULL REFERENCES classes(id) ON DELETE SET NULL,
    teacher_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL CHECK (category IN ('SLIDE', 'LIVRO', 'APOSTILA', 'EXERCICIO', 'AVALIACAO', 'ARTIGO', 'OUTRO')),
    current_status TEXT NOT NULL DEFAULT 'ENVIADO' CHECK (current_status IN (
        'ENVIADO', 'AGUARDANDO_PROCESSAMENTO', 'PROCESSANDO', 'PROCESSADO',
        'AGUARDANDO_REVISAO', 'EM_REVISAO', 'CORRECAO_SOLICITADA',
        'APROVADO', 'REPROVADO', 'PUBLICADO', 'ARQUIVADO', 'FALHA_PROCESSAMENTO'
    )),
    publish_at TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO materials_new (id, subject_id, class_id, teacher_user_id, title, description, category, current_status, publish_at, created_at, updated_at)
SELECT id, subject_id, class_id, teacher_user_id, title, description, category, current_status, publish_at, created_at, updated_at
FROM materials;

DROP TABLE materials;
ALTER TABLE materials_new RENAME TO materials;

CREATE INDEX IF NOT EXISTS idx_materials_subject ON materials(subject_id);
CREATE INDEX IF NOT EXISTS idx_materials_teacher ON materials(teacher_user_id);
CREATE INDEX IF NOT EXISTS idx_materials_status ON materials(current_status);

PRAGMA foreign_keys=ON;
