-- Migração 002: Tabela de Preferências de UI do Usuário
CREATE TABLE IF NOT EXISTS user_ui_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    contrast_mode TEXT NOT NULL DEFAULT 'normal' CHECK (contrast_mode IN ('normal', 'high')),
    font_size TEXT NOT NULL DEFAULT 'normal' CHECK (font_size IN ('normal', 'font-lg', 'font-xl')),
    dyslexia_font INTEGER NOT NULL DEFAULT 0 CHECK (dyslexia_font IN (0, 1)),
    preferred_download_format TEXT NOT NULL DEFAULT 'html' CHECK (preferred_download_format IN ('html', 'pdf_ua', 'docx', 'txt', 'mp3', 'zip')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
