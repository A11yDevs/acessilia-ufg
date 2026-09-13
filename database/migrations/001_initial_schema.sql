-- ============================================================================
-- MIGRAÇÃO 001: ESTRUTURA INSTITUCIONAL, RBAC, USUÁRIOS E SEGURANÇA
-- ============================================================================

-- 1. Instituições
CREATE TABLE IF NOT EXISTS institutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    trade_name TEXT,
    cnpj TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Campi
CREATE TABLE IF NOT EXISTS campuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (institution_id, code)
);

-- 3. Departamentos
CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campus_id INTEGER NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (campus_id, code)
);

-- 4. Cursos
CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    modality TEXT NOT NULL CHECK (modality IN ('PRESENCIAL', 'EAD', 'HIBRIDO')),
    duration_semesters INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (department_id, code)
);

-- 5. Disciplinas (Catálogo Geral)
CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    workload_hours INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Matriz Curricular (Curso <-> Disciplina M:N)
CREATE TABLE IF NOT EXISTS course_subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    recommended_semester INTEGER NOT NULL,
    is_mandatory INTEGER NOT NULL DEFAULT 1 CHECK (is_mandatory IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, subject_id)
);

-- 7. Períodos Letivos
CREATE TABLE IF NOT EXISTS academic_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (institution_id, code)
);

-- 8. Turmas (Vinculadas a Curso, Disciplina e Período)
CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    academic_period_id INTEGER NOT NULL REFERENCES academic_periods(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    location TEXT,
    schedule_description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED', 'CANCELLED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, subject_id, academic_period_id, code)
);

-- 9. Usuários
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    social_name TEXT,
    email TEXT NOT NULL UNIQUE,
    registration_number TEXT UNIQUE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLOCKED')),
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT NULL,
    last_login_at TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. Sessões Persistentes
CREATE TABLE IF NOT EXISTS sessions (
    sessionId TEXT PRIMARY KEY,
    sessionData TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
);

-- 11. Tokens de Recuperação de Senha
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 12. Papéis (Roles)
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 13. Permissões Granulares
CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    module TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 14. Associação Papel <-> Permissão
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 15. Associação Usuário <-> Papel
CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);

-- 16. Extensão de Professores
CREATE TABLE IF NOT EXISTS teachers_profile (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    academic_title TEXT,
    office_location TEXT
);

-- 17. Extensão de Alunos (Apenas Dados Acadêmicos)
CREATE TABLE IF NOT EXISTS students_profile (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    entry_period_id INTEGER NOT NULL REFERENCES academic_periods(id) ON DELETE RESTRICT,
    current_semester INTEGER NOT NULL DEFAULT 1
);

-- 18. Preferências de Acessibilidade (Privacy by Design - Isolado)
CREATE TABLE IF NOT EXISTS student_accessibility_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferred_format TEXT NOT NULL,
    needed_assistive_tech TEXT,
    authorized_observations TEXT,
    consent_given_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 19. Professores da Turma
CREATE TABLE IF NOT EXISTS class_teachers (
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    teacher_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role_in_class TEXT NOT NULL DEFAULT 'TITULAR' CHECK (role_in_class IN ('TITULAR', 'ADJUNTO')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (class_id, teacher_user_id)
);

-- 20. Alunos Matriculados na Turma
CREATE TABLE IF NOT EXISTS class_students (
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'MATRICULADO' CHECK (status IN ('MATRICULADO', 'TRANCADO', 'CONCLUIDO')),
    enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (class_id, student_user_id)
);

-- 21. Monitores da Turma
CREATE TABLE IF NOT EXISTS class_monitors (
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    monitor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (class_id, monitor_user_id)
);

-- 22. Materiais Acadêmicos
CREATE TABLE IF NOT EXISTS materials (
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
        'APROVADO', 'REPROVADO', 'PUBLICADO', 'ARQUIVADO'
    )),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 23. Versões de Materiais (Desacoplado de Armazenamento + SHA-256)
CREATE TABLE IF NOT EXISTS material_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    storage_provider TEXT NOT NULL DEFAULT 'LOCAL_DISK' CHECK (storage_provider IN ('LOCAL_DISK', 'S3_COMPATIBLE', 'MINIO', 'GCS')),
    storage_key TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    sha256_hash TEXT NOT NULL,
    version_type TEXT NOT NULL CHECK (version_type IN ('ORIGINAL', 'PROCESSADO_BOT', 'REVISADO_HUMANO')),
    uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (material_id, version_number)
);

-- 24. Jobs Assíncronos com Idempotência Estrita
CREATE TABLE IF NOT EXISTS processing_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotency_key TEXT NOT NULL UNIQUE,
    material_version_id INTEGER NOT NULL REFERENCES material_versions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'bot-acess',
    external_job_id TEXT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'
    )),
    attempts INTEGER NOT NULL DEFAULT 0,
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT NULL,
    finished_at TEXT NULL,
    error_message TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 25. Solicitações de Acessibilidade
CREATE TABLE IF NOT EXISTS accessibility_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE')),
    status TEXT NOT NULL DEFAULT 'SOLICITADA' CHECK (status IN (
        'SOLICITADA', 'EM_ATENDIMENTO', 'PROCESSANDO', 'EM_REVISAO', 'CONCLUIDA', 'CANCELADA'
    )),
    specific_notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 26. Revisões
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_version_id INTEGER NOT NULL REFERENCES material_versions(id) ON DELETE CASCADE,
    reviewer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'EM_ANDAMENTO' CHECK (status IN ('EM_ANDAMENTO', 'APROVADO', 'REPROVADO', 'CORRECAO_SOLICITADA')),
    general_notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT NULL
);

-- 27. Apontamentos da Revisão
CREATE TABLE IF NOT EXISTS review_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    page_or_section TEXT,
    comment TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'OBSERVACAO' CHECK (severity IN ('OBSERVACAO', 'IMPORTANTE', 'IMPEDIMENTO')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 28. Notificações Seguras (Rotas Canônicas Internas)
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    target_resource TEXT NOT NULL,
    target_resource_id INTEGER NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 29. Logs de Auditoria
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    resource_id TEXT NULL,
    ip_address TEXT NULL,
    user_agent TEXT NULL,
    details_json TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 30. Configurações Globais do Sistema
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ÍNDICES DE DESEMPENHO E CONSULTA FREQUENTE
CREATE INDEX IF NOT EXISTS idx_campuses_inst ON campuses(institution_id);
CREATE INDEX IF NOT EXISTS idx_departments_campus ON departments(campus_id);
CREATE INDEX IF NOT EXISTS idx_courses_dept ON courses(department_id);
CREATE INDEX IF NOT EXISTS idx_subjects_dept ON subjects(department_id);
CREATE INDEX IF NOT EXISTS idx_course_subjects_course ON course_subjects(course_id);
CREATE INDEX IF NOT EXISTS idx_course_subjects_subject ON course_subjects(subject_id);
CREATE INDEX IF NOT EXISTS idx_classes_course ON classes(course_id);
CREATE INDEX IF NOT EXISTS idx_classes_subject ON classes(subject_id);
CREATE INDEX IF NOT EXISTS idx_classes_period ON classes(academic_period_id);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_reg_number ON users(registration_number);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);
CREATE INDEX IF NOT EXISTS idx_password_tokens ON password_reset_tokens(token_hash, expires_at);

CREATE INDEX IF NOT EXISTS idx_materials_subject ON materials(subject_id);
CREATE INDEX IF NOT EXISTS idx_materials_teacher ON materials(teacher_user_id);
CREATE INDEX IF NOT EXISTS idx_materials_status ON materials(current_status);
CREATE INDEX IF NOT EXISTS idx_versions_material ON material_versions(material_id);
CREATE INDEX IF NOT EXISTS idx_jobs_version ON processing_jobs(material_version_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_idempotency ON processing_jobs(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_reviews_version ON reviews(material_version_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer_user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);
