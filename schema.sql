CREATE TABLE IF NOT EXISTS CacheEntries (EntryKey TEXT PRIMARY KEY, Entry TEXT, Expiration INTEGER, ContentType TEXT, CachedOn INTEGER);
CREATE INDEX IF NOT EXISTS idx_entrykey ON CacheEntries(EntryKey);
CREATE INDEX IF NOT EXISTS idx_expiration ON CacheEntries(Expiration);
CREATE INDEX IF NOT EXISTS idx_content_type ON CacheEntries(ContentType);
