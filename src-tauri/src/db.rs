use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbMemo {
    pub id: i64,
    pub slug: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub tags: String, // JSON string
    pub url: String,
    pub synced_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncStatus {
    pub id: i64,
    pub last_sync_at: Option<String>,
    pub total_memos: i64,
    pub status: String, // "idle", "syncing", "completed", "failed", "cancelled"
    pub error_message: Option<String>,
}

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(db_path: &Path) -> Result<Self, String> {
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to connect to database: {}", e))?;
        
        let db = Self { 
            conn: Arc::new(Mutex::new(conn))
        };
        db.initialize()?;
        
        Ok(db)
    }
    
    fn initialize(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        
        // Create memos table
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS memos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT NOT NULL UNIQUE,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                url TEXT NOT NULL,
                synced_at TEXT NOT NULL
            )
            "#,
            [],
        )
        .map_err(|e| format!("Failed to create memos table: {}", e))?;
        
        // Create sync_status table
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS sync_status (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                last_sync_at TEXT,
                total_memos INTEGER DEFAULT 0,
                status TEXT DEFAULT 'idle',
                error_message TEXT
            )
            "#,
            [],
        )
        .map_err(|e| format!("Failed to create sync_status table: {}", e))?;
        
        // Initialize sync_status if it doesn't exist
        conn.execute(
            r#"
            INSERT OR IGNORE INTO sync_status (id, status) VALUES (1, 'idle')
            "#,
            [],
        )
        .map_err(|e| format!("Failed to initialize sync_status: {}", e))?;
        
        // Create indexes
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_memos_created_at ON memos(created_at)",
            [],
        )
        .map_err(|e| format!("Failed to create index: {}", e))?;
        
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_memos_updated_at ON memos(updated_at)",
            [],
        )
        .map_err(|e| format!("Failed to create index: {}", e))?;
        
        Ok(())
    }
    
    pub fn upsert_memo(&self, memo: &crate::Memo) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let tags_json = serde_json::to_string(&memo.tags)
            .map_err(|e| format!("Failed to serialize tags: {}", e))?;
        
        let url = memo.url.as_ref().unwrap_or(&String::new()).clone();
        let synced_at = Utc::now().to_rfc3339();
        
        conn.execute(
            r#"
            INSERT INTO memos (slug, content, created_at, updated_at, tags, url, synced_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(slug) DO UPDATE SET
                content = excluded.content,
                updated_at = excluded.updated_at,
                tags = excluded.tags,
                url = excluded.url,
                synced_at = excluded.synced_at
            "#,
            params![
                &memo.slug,
                &memo.content,
                &memo.created_at,
                &memo.updated_at,
                &tags_json,
                &url,
                &synced_at
            ],
        )
        .map_err(|e| format!("Failed to upsert memo: {}", e))?;
        
        Ok(())
    }
    
    pub fn bulk_upsert_memos(&self, memos: &[crate::Memo]) -> Result<(), String> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        
        for memo in memos {
            let tags_json = serde_json::to_string(&memo.tags)
                .map_err(|e| format!("Failed to serialize tags: {}", e))?;
            
            let url = memo.url.as_ref().unwrap_or(&String::new()).clone();
            let synced_at = Utc::now().to_rfc3339();
            
            tx.execute(
                r#"
                INSERT INTO memos (slug, content, created_at, updated_at, tags, url, synced_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(slug) DO UPDATE SET
                    content = excluded.content,
                    updated_at = excluded.updated_at,
                    tags = excluded.tags,
                    url = excluded.url,
                    synced_at = excluded.synced_at
                "#,
                params![
                    &memo.slug,
                    &memo.content,
                    &memo.created_at,
                    &memo.updated_at,
                    &tags_json,
                    &url,
                    &synced_at
                ],
            )
            .map_err(|e| format!("Failed to upsert memo in transaction: {}", e))?;
        }
        
        tx.commit()
            .map_err(|e| format!("Failed to commit transaction: {}", e))?;
        
        Ok(())
    }
    
    pub fn get_memos_page(
        &self,
        order_by: &str,
        order_dir: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<crate::Memo>, String> {
        let conn = self.conn.lock().unwrap();
        let order_field = match order_by {
            "updated_at" => "updated_at",
            _ => "created_at",
        };
        
        let order_direction = match order_dir {
            "asc" => "ASC",
            _ => "DESC",
        };
        
        let query = format!(
            "SELECT * FROM memos ORDER BY {} {} LIMIT ?1 OFFSET ?2",
            order_field, order_direction
        );
        
        let mut stmt = conn.prepare(&query)
            .map_err(|e| format!("Failed to prepare query: {}", e))?;
        
        let memos_iter = stmt.query_map(params![limit, offset], |row| {
            Ok(DbMemo {
                id: row.get(0)?,
                slug: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                tags: row.get(5)?,
                url: row.get(6)?,
                synced_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Failed to query memos: {}", e))?;
        
        let memos: Result<Vec<_>, _> = memos_iter
            .map(|row_result| {
                row_result.map(|row| {
                    let tags: Vec<String> = serde_json::from_str(&row.tags).unwrap_or_default();
                    crate::Memo {
                        slug: row.slug,
                        content: row.content,
                        created_at: row.created_at,
                        updated_at: row.updated_at,
                        tags,
                        url: Some(row.url),
                    }
                })
            })
            .collect();
        
        memos.map_err(|e| format!("Failed to fetch memos: {}", e))
    }
    
    pub fn search_memos(
        &self,
        query: &str,
        order_by: &str,
        order_dir: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<crate::Memo>, String> {
        let conn = self.conn.lock().unwrap();
        let order_field = match order_by {
            "updated_at" => "updated_at",
            _ => "created_at",
        };
        
        let order_direction = match order_dir {
            "asc" => "ASC",
            _ => "DESC",
        };
        
        let search_query = format!(
            "SELECT * FROM memos WHERE content LIKE ?1 OR tags LIKE ?2 ORDER BY {} {} LIMIT ?3 OFFSET ?4",
            order_field, order_direction
        );
        
        let search_pattern = format!("%{}%", query);
        
        let mut stmt = conn.prepare(&search_query)
            .map_err(|e| format!("Failed to prepare search query: {}", e))?;
        
        let memos_iter = stmt.query_map(
            params![&search_pattern, &search_pattern, limit, offset],
            |row| {
                Ok(DbMemo {
                    id: row.get(0)?,
                    slug: row.get(1)?,
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    tags: row.get(5)?,
                    url: row.get(6)?,
                    synced_at: row.get(7)?,
                })
            },
        )
        .map_err(|e| format!("Failed to search memos: {}", e))?;
        
        let memos: Result<Vec<_>, _> = memos_iter
            .map(|row_result| {
                row_result.map(|row| {
                    let tags: Vec<String> = serde_json::from_str(&row.tags).unwrap_or_default();
                    crate::Memo {
                        slug: row.slug,
                        content: row.content,
                        created_at: row.created_at,
                        updated_at: row.updated_at,
                        tags,
                        url: Some(row.url),
                    }
                })
            })
            .collect();
        
        memos.map_err(|e| format!("Failed to search memos: {}", e))
    }
    
    pub fn get_all_memos(&self) -> Result<Vec<crate::Memo>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM memos ORDER BY created_at DESC")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;
        
        let memos_iter = stmt.query_map([], |row| {
            Ok(DbMemo {
                id: row.get(0)?,
                slug: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                tags: row.get(5)?,
                url: row.get(6)?,
                synced_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Failed to query all memos: {}", e))?;
        
        let memos: Result<Vec<_>, _> = memos_iter
            .map(|row_result| {
                row_result.map(|row| {
                    let tags: Vec<String> = serde_json::from_str(&row.tags).unwrap_or_default();
                    crate::Memo {
                        slug: row.slug,
                        content: row.content,
                        created_at: row.created_at,
                        updated_at: row.updated_at,
                        tags,
                        url: Some(row.url),
                    }
                })
            })
            .collect();
        
        memos.map_err(|e| format!("Failed to fetch all memos: {}", e))
    }
    
    pub fn get_memo_count(&self) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM memos", [], |row| row.get(0))
            .map_err(|e| format!("Failed to count memos: {}", e))?;
        
        Ok(count)
    }
    
    pub fn update_sync_status(
        &self,
        status: &str,
        total_memos: Option<i64>,
        error_message: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        
        match (total_memos, error_message, status) {
            (Some(total), Some(error), _) => {
                conn.execute(
                    "UPDATE sync_status SET status = ?1, total_memos = ?2, error_message = ?3 WHERE id = 1",
                    params![status, total, error],
                )
            }
            (Some(total), None, "completed") => {
                conn.execute(
                    "UPDATE sync_status SET status = ?1, total_memos = ?2, last_sync_at = ?3, error_message = NULL WHERE id = 1",
                    params![status, total, Utc::now().to_rfc3339()],
                )
            }
            (Some(total), None, _) => {
                conn.execute(
                    "UPDATE sync_status SET status = ?1, total_memos = ?2 WHERE id = 1",
                    params![status, total],
                )
            }
            (None, Some(error), _) => {
                conn.execute(
                    "UPDATE sync_status SET status = ?1, error_message = ?2 WHERE id = 1",
                    params![status, error],
                )
            }
            (None, None, "completed") => {
                conn.execute(
                    "UPDATE sync_status SET status = ?1, last_sync_at = ?2, error_message = NULL WHERE id = 1",
                    params![status, Utc::now().to_rfc3339()],
                )
            }
            (None, None, "idle") => {
                conn.execute(
                    "UPDATE sync_status SET status = ?1, error_message = NULL WHERE id = 1",
                    params![status],
                )
            }
            (None, None, _) => {
                conn.execute(
                    "UPDATE sync_status SET status = ?1 WHERE id = 1",
                    params![status],
                )
            }
        }
        .map_err(|e| format!("Failed to update sync status: {}", e))?;
        
        Ok(())
    }
    
    pub fn get_sync_status(&self) -> Result<SyncStatus, String> {
        let conn = self.conn.lock().unwrap();
        let status = conn.query_row(
            "SELECT id, last_sync_at, total_memos, status, error_message FROM sync_status WHERE id = 1",
            [],
            |row| {
                Ok(SyncStatus {
                    id: row.get(0)?,
                    last_sync_at: row.get(1)?,
                    total_memos: row.get(2)?,
                    status: row.get(3)?,
                    error_message: row.get(4)?,
                })
            },
        )
        .map_err(|e| format!("Failed to get sync status: {}", e))?;
        
        Ok(status)
    }
    
    pub fn clear_all_memos(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM memos", [])
            .map_err(|e| format!("Failed to clear memos: {}", e))?;
        
        drop(conn); // Release the lock before calling update_sync_status
        self.update_sync_status("idle", Some(0), None)?;
        
        Ok(())
    }
}