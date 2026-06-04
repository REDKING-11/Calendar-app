CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(160) NULL,
  role VARCHAR(24) NOT NULL DEFAULT 'member',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  INDEX idx_users_role_active (role, is_active)
);

CREATE TABLE IF NOT EXISTS install_settings (
  id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
  organization_name VARCHAR(160) NOT NULL DEFAULT 'SelfHdb',
  admin_user_id CHAR(36) NULL,
  installed_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_install_settings_admin FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  device_type VARCHAR(40) NOT NULL DEFAULT 'desktop',
  created_at DATETIME(6) NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  is_trusted TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_devices_user_last_seen (user_id, last_seen_at)
);

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  device_id CHAR(64) NOT NULL,
  access_token_id CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  last_used_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sessions_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_sessions_user_device (user_id, device_id),
  INDEX idx_sessions_last_used (last_used_at)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id CHAR(36) PRIMARY KEY,
  session_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  device_id CHAR(64) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  rotated_from_id CHAR(36) NULL,
  revoked_at DATETIME(6) NULL,
  CONSTRAINT fk_refresh_tokens_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_refresh_tokens_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_refresh_tokens_session (session_id),
  INDEX idx_refresh_tokens_user_device (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS calendars (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#4f9d69',
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  deleted_at DATETIME(6) NULL,
  CONSTRAINT fk_calendars_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_calendars_user (user_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id CHAR(36) PRIMARY KEY,
  calendar_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#475569',
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  deleted_at DATETIME(6) NULL,
  CONSTRAINT fk_categories_calendar FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE,
  INDEX idx_categories_calendar (calendar_id)
);

CREATE TABLE IF NOT EXISTS sync_state (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  device_id CHAR(64) NOT NULL,
  last_server_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_device_sequence_seen BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_sync_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_state_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_sync_state_user_device (user_id, device_id),
  INDEX idx_sync_state_user_sequence (user_id, last_server_sequence)
);

CREATE TABLE IF NOT EXISTS sync_envelopes (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  device_id CHAR(64) NOT NULL,
  device_sequence BIGINT UNSIGNED NOT NULL,
  server_sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  entity VARCHAR(40) NOT NULL,
  entity_id CHAR(64) NOT NULL,
  operation VARCHAR(16) NOT NULL,
  metadata_patch_json JSON NOT NULL,
  content_patch_json LONGTEXT NULL,
  encrypted_content_patch LONGTEXT NULL,
  nonce VARCHAR(128) NOT NULL,
  client_timestamp DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_sync_envelopes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sync_envelopes_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_sync_envelopes_device_sequence (device_id, device_sequence),
  INDEX idx_sync_envelopes_user_sequence (user_id, server_sequence)
);

CREATE TABLE IF NOT EXISTS events_metadata (
  id CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  calendar_id CHAR(36) NULL,
  category_id CHAR(36) NULL,
  starts_at DATETIME(6) NOT NULL,
  ends_at DATETIME(6) NOT NULL,
  is_all_day TINYINT(1) NOT NULL DEFAULT 0,
  visibility VARCHAR(24) NOT NULL DEFAULT 'private',
  status VARCHAR(24) NOT NULL DEFAULT 'confirmed',
  sync_policy VARCHAR(32) NOT NULL DEFAULT 'internal_only',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  last_modified_by_device_id CHAR(64) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  deleted_at DATETIME(6) NULL,
  CONSTRAINT fk_events_metadata_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_metadata_calendar FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE SET NULL,
  CONSTRAINT fk_events_metadata_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_events_metadata_device FOREIGN KEY (last_modified_by_device_id) REFERENCES devices(id) ON DELETE SET NULL,
  INDEX idx_events_metadata_user_range (user_id, starts_at, ends_at),
  INDEX idx_events_metadata_user_updated (user_id, updated_at)
);

CREATE TABLE IF NOT EXISTS event_content (
  event_id CHAR(64) PRIMARY KEY,
  encrypted_payload LONGTEXT NOT NULL,
  materialized_json LONGTEXT NULL,
  key_version INT NOT NULL DEFAULT 1,
  updated_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_event_content_event FOREIGN KEY (event_id) REFERENCES events_metadata(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_shares (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  public_token VARCHAR(128) NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  access_mode VARCHAR(24) NOT NULL DEFAULT 'link',
  privacy_level VARCHAR(32) NOT NULL DEFAULT 'busy_only',
  scope_json JSON NOT NULL,
  projection_json LONGTEXT NULL,
  projection_updated_at DATETIME(6) NULL,
  expires_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  last_accessed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_calendar_shares_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_calendar_shares_user_updated (user_id, updated_at),
  INDEX idx_calendar_shares_token_hash (token_hash)
);

CREATE TABLE IF NOT EXISTS invite_keys (
  id CHAR(36) PRIMARY KEY,
  code_hash CHAR(64) NOT NULL UNIQUE,
  label VARCHAR(160) NOT NULL,
  role VARCHAR(24) NOT NULL DEFAULT 'member',
  max_uses INT UNSIGNED NULL,
  use_count INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  last_used_at DATETIME(6) NULL,
  created_by_user_id CHAR(36) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_invite_keys_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_invite_keys_updated (updated_at)
);

CREATE TABLE IF NOT EXISTS invite_key_uses (
  id CHAR(36) PRIMARY KEY,
  invite_key_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  ip_address VARCHAR(64) NULL,
  used_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_invite_key_uses_key FOREIGN KEY (invite_key_id) REFERENCES invite_keys(id) ON DELETE CASCADE,
  CONSTRAINT fk_invite_key_uses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_invite_key_uses_key (invite_key_id)
);

CREATE TABLE IF NOT EXISTS calendar_share_recipients (
  id CHAR(36) PRIMARY KEY,
  share_id CHAR(36) NOT NULL,
  recipient_user_id CHAR(36) NULL,
  email VARCHAR(190) NULL,
  access_level VARCHAR(24) NOT NULL DEFAULT 'read',
  revoked_at DATETIME(6) NULL,
  last_accessed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_calendar_share_recipients_share FOREIGN KEY (share_id) REFERENCES calendar_shares(id) ON DELETE CASCADE,
  CONSTRAINT fk_calendar_share_recipients_user FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_calendar_share_recipients_user (recipient_user_id),
  INDEX idx_calendar_share_recipients_email (email)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  device_id CHAR(64) NULL,
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(40) NULL,
  target_id VARCHAR(80) NULL,
  ip_address VARCHAR(64) NULL,
  metadata_json JSON NULL,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_audit_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_log_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
  INDEX idx_audit_log_user_created (user_id, created_at)
);
