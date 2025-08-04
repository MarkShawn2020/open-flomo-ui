use chrono::{DateTime, NaiveDateTime, Utc, TimeZone};
use reqwest::header::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use md5;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use tauri::{Emitter, Manager, State};
use std::sync::Mutex;

mod db;
use db::Database;

// Helper function to format dates according to the given format string
fn format_date(date_str: &str, format: &str) -> String {
    // Parse the date string
    let parsed = DateTime::parse_from_rfc3339(date_str)
        .map(|dt| dt.with_timezone(&Utc))
        .or_else(|_| {
            NaiveDateTime::parse_from_str(date_str, "%Y-%m-%d %H:%M:%S")
                .map(|dt| Utc.from_utc_datetime(&dt))
        });
    
    if let Ok(parsed) = parsed {
        // Convert common date format patterns to chrono format
        let chrono_format = format
            .replace("yyyy", "%Y")
            .replace("MM", "%m")
            .replace("dd", "%d")
            .replace("HH", "%H")
            .replace("mm", "%M")
            .replace("ss", "%S")
            .replace("MMM", "%b");
        
        // Handle special formats
        if format.contains("年") {
            // Chinese date format
            return parsed.format("%Y年%m月%d日 %H:%M").to_string();
        }
        
        parsed.format(&chrono_format).to_string()
    } else {
        // If parsing fails, return the original string
        date_str.to_string()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Memo {
    pub slug: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ApiResponse {
    code: i32,
    data: Option<Vec<ApiMemo>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ApiMemo {
    slug: String,
    content: String,
    created_at: String,
    updated_at: String,
    tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AppConfig {
    authorization: Option<String>,
}

pub struct FlomoClient {
    token: String,
    client: reqwest::Client,
}

impl FlomoClient {
    const LIMIT: usize = 200;
    const URL_UPDATED: &'static str = "https://flomoapp.com/api/v1/memo/updated/";
    const SALT: &'static str = "dbbc3dd73364b4084c3a69346e0ce2b2";

    pub fn new(token: String) -> Self {
        let client = reqwest::Client::new();
        let token = if token.starts_with("Bearer ") {
            token
        } else {
            format!("Bearer {}", token)
        };
        
        Self { token, client }
    }

    pub fn get_params(&self, latest_slug: Option<&str>, latest_updated_at: Option<i64>) -> HashMap<String, String> {
        let mut params = HashMap::new();
        params.insert("limit".to_string(), Self::LIMIT.to_string());
        params.insert("tz".to_string(), "8:0".to_string());
        params.insert("timestamp".to_string(), chrono::Utc::now().timestamp().to_string());
        params.insert("api_key".to_string(), "flomo_web".to_string());
        params.insert("app_version".to_string(), "5.25.64".to_string());
        params.insert("platform".to_string(), "mac".to_string());
        params.insert("webp".to_string(), "1".to_string());
        

        // Add pagination parameters if available
        // Note: We should add slug even if updated_at is missing
        if let Some(slug) = latest_slug {
            params.insert("latest_slug".to_string(), slug.to_string());
        }
        
        if let Some(updated_at) = latest_updated_at {
            params.insert("latest_updated_at".to_string(), updated_at.to_string());
        }

        // Generate sign (using MD5 to match Python implementation)
        let mut sorted_params: Vec<(&String, &String)> = params.iter().collect();
        sorted_params.sort_by_key(|&(k, _)| k);
        
        let param_str = sorted_params
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("&");
        
        let sign_str = format!("{}{}", param_str, Self::SALT);
        
        
        let sign = format!("{:x}", md5::compute(sign_str.as_bytes()));
        
        params.insert("sign".to_string(), sign);
        
        // Log pagination parameters for debugging
        if latest_slug.is_some() || latest_updated_at.is_some() {
            println!("Pagination params: latest_slug={:?}, latest_updated_at={:?}", 
                     latest_slug, latest_updated_at);
        }
        
        params
    }

    pub async fn get_all_memos(&self) -> Result<Vec<Memo>, String> {
        let mut all_memos = Vec::new();
        let mut latest_slug: Option<String> = None;
        let mut latest_updated_at: Option<i64> = None;

        loop {
            let params = self.get_params(latest_slug.as_deref(), latest_updated_at);
            
            
            let mut headers = HeaderMap::new();
            headers.insert(
                "authorization",
                HeaderValue::from_str(&self.token).map_err(|e| {
                        e.to_string()
                })?,
            );


            let response = self.client
                .get(Self::URL_UPDATED)
                .headers(headers)
                .query(&params)
                .send()
                .await
                .map_err(|e| {
                        e.to_string()
                })?;

            
            // Get response text first for debugging
            let response_text = response.text().await.map_err(|e| {
                e.to_string()
            })?;
            
            
            // Parse the response
            let api_response: ApiResponse = serde_json::from_str(&response_text).map_err(|e| {
                format!("JSON parse error: {} - Response was: {}", e, response_text)
            })?;


            if api_response.code != 0 {
                return Err(format!("API error: code {} - Response: {}", api_response.code, response_text));
            }

            let memos = api_response.data.unwrap_or_default();
            
            if memos.is_empty() {
                break;
            }

            let should_continue = memos.len() >= Self::LIMIT;
            
            if should_continue {
                let last_memo = &memos[memos.len() - 1];
                latest_slug = Some(last_memo.slug.clone());
                
                if let Ok(dt) = DateTime::parse_from_rfc3339(&last_memo.updated_at) {
                    latest_updated_at = Some(dt.timestamp());
                }
            }

            // Convert API memos to our Memo struct
            for api_memo in memos {
                let memo = Memo {
                    slug: api_memo.slug.clone(),
                    content: parse_html_to_text(&api_memo.content),
                    created_at: api_memo.created_at,
                    updated_at: api_memo.updated_at,
                    tags: api_memo.tags,
                    url: Some(format!("https://v.flomoapp.com/mine/?memo_id={}", api_memo.slug)),
                };
                all_memos.push(memo);
            }

            if !should_continue {
                break;
            }
        }

        Ok(all_memos)
    }
}

fn parse_html_to_text(html: &str) -> String {
    // Simple HTML to text conversion
    html2text::from_read(html.as_bytes(), 80)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PagedResponse {
    memos: Vec<Memo>,
    has_more: bool,
    next_slug: Option<String>,
    next_updated_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncProgress {
    pub total: usize,
    pub current: usize,
    pub status: String,
    pub message: String,
}

pub struct AppState {
    pub db: Arc<Mutex<Option<Database>>>,
    pub sync_cancelled: Arc<AtomicBool>,
}

// Tauri commands
#[tauri::command]
async fn get_memos(token: String) -> Result<Vec<Memo>, String> {
    let client = FlomoClient::new(token);
    client.get_all_memos().await
}

#[tauri::command]
async fn get_memos_page(
    token: String,
    latest_slug: Option<String>,
    latest_updated_at: Option<i64>,
) -> Result<PagedResponse, String> {
    let client = FlomoClient::new(token);
    
    let params = client.get_params(latest_slug.as_deref(), latest_updated_at);
    
    let mut headers = HeaderMap::new();
    headers.insert(
        "authorization",
        HeaderValue::from_str(&client.token).map_err(|e| e.to_string())?,
    );

    let response = client.client
        .get(FlomoClient::URL_UPDATED)
        .headers(headers)
        .query(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let response_text = response.text().await.map_err(|e| e.to_string())?;
    let api_response: ApiResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("JSON parse error: {}", e))?;

    if api_response.code != 0 {
        return Err(format!("API error: code {}", api_response.code));
    }

    let api_memos = api_response.data.unwrap_or_default();
    let has_more = api_memos.len() >= FlomoClient::LIMIT;
    
    let (next_slug, next_updated_at) = if has_more && !api_memos.is_empty() {
        let last_memo = &api_memos[api_memos.len() - 1];
        let updated_at = DateTime::parse_from_rfc3339(&last_memo.updated_at)
            .ok()
            .map(|dt| dt.timestamp());
        (Some(last_memo.slug.clone()), updated_at)
    } else {
        (None, None)
    };

    let memos: Vec<Memo> = api_memos.into_iter().map(|api_memo| Memo {
        slug: api_memo.slug.clone(),
        content: parse_html_to_text(&api_memo.content),
        created_at: api_memo.created_at,
        updated_at: api_memo.updated_at,
        tags: api_memo.tags,
        url: Some(format!("https://v.flomoapp.com/mine/?memo_id={}", api_memo.slug)),
    }).collect();

    Ok(PagedResponse {
        memos,
        has_more,
        next_slug,
        next_updated_at,
    })
}

#[tauri::command]
async fn search_memos(token: String, query: String) -> Result<Vec<Memo>, String> {
    let client = FlomoClient::new(token);
    let all_memos = client.get_all_memos().await?;
    
    let filtered: Vec<Memo> = all_memos
        .into_iter()
        .filter(|memo| {
            memo.content.to_lowercase().contains(&query.to_lowercase())
                || memo.tags.iter().any(|tag| tag.to_lowercase().contains(&query.to_lowercase()))
        })
        .collect();
    
    Ok(filtered)
}

#[tauri::command]
async fn search_memos_page(
    token: String,
    query: String,
    offset: usize,
    limit: usize,
) -> Result<PagedResponse, String> {
    let client = FlomoClient::new(token);
    let all_memos = client.get_all_memos().await?;
    
    let filtered: Vec<Memo> = all_memos
        .into_iter()
        .filter(|memo| {
            memo.content.to_lowercase().contains(&query.to_lowercase())
                || memo.tags.iter().any(|tag| tag.to_lowercase().contains(&query.to_lowercase()))
        })
        .skip(offset)
        .take(limit + 1)
        .collect();
    
    let has_more = filtered.len() > limit;
    let memos = if has_more {
        filtered.into_iter().take(limit).collect()
    } else {
        filtered
    };
    
    Ok(PagedResponse {
        memos,
        has_more,
        next_slug: None,
        next_updated_at: None,
    })
}

#[tauri::command]
async fn save_config(app: tauri::AppHandle, token: String) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    
    let store = app.store("config.json").map_err(|e| e.to_string())?;
    store.set("authorization", serde_json::Value::String(token));
    store.save().map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn load_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_store::StoreExt;
    
    let store = app.store("config.json").map_err(|e| e.to_string())?;
    
    if let Some(value) = store.get("authorization") {
        if let Some(token) = value.as_str() {
            return Ok(Some(token.to_string()));
        }
    }
    
    Ok(None)
}

#[tauri::command]
fn format_memos_json(memos: Vec<Memo>) -> String {
    serde_json::to_string_pretty(&memos).unwrap_or_default()
}

#[tauri::command]
fn format_memos_markdown(memos: Vec<Memo>) -> String {
    let mut output = String::from("# Flomo 备忘录\n\n");
    
    for (index, memo) in memos.iter().enumerate() {
        output.push_str(&format!("## {}. {}\n\n", index + 1, memo.created_at));
        output.push_str(&format!("{}\n\n", memo.content));
        
        if let Some(url) = &memo.url {
            output.push_str(&format!("**链接**: {}\n", url));
        }
        
        if !memo.tags.is_empty() {
            output.push_str(&format!("**标签**: {}\n", memo.tags.join(", ")));
        }
        
        output.push_str("\n---\n\n");
    }
    
    output
}

#[tauri::command]
fn format_memos_table(memos: Vec<Memo>) -> String {
    let mut output = String::from("序号 | 创建时间          | 内容预览\n");
    output.push_str(&"-".repeat(50));
    output.push('\n');
    
    for (index, memo) in memos.iter().enumerate() {
        let content_preview = memo.content
            .replace('\n', " ")
            .chars()
            .take(30)
            .collect::<String>();
        
        let created_at = memo.created_at.split(' ').next().unwrap_or(&memo.created_at);
        output.push_str(&format!("{:2}   | {:17} | {}\n", 
            index + 1, 
            created_at,
            if content_preview.len() >= 30 {
                format!("{}...", content_preview)
            } else {
                content_preview
            }
        ));
    }
    
    output
}

#[derive(Debug, Deserialize)]
struct JsonFormatArgs {
    memos: Vec<Memo>,
    compact: bool,
    #[serde(rename = "dateFormat")]
    date_format: String,
}

#[tauri::command]
fn format_memos_json_with_options(args: JsonFormatArgs) -> String {
    let JsonFormatArgs { memos, compact, date_format } = args;
    let processed_memos: Vec<serde_json::Value> = memos.iter().enumerate().map(|(index, memo)| {
        let mut obj = serde_json::json!({
            "index": index + 1,
            "content": memo.content,
            "url": memo.url,
            "slug": memo.slug,
            "tags": memo.tags,
        });
        
        if !date_format.is_empty() {
            obj["created_at"] = serde_json::json!(format_date(&memo.created_at, &date_format));
            obj["updated_at"] = serde_json::json!(format_date(&memo.updated_at, &date_format));
        }
        
        obj
    }).collect();
    
    if compact {
        serde_json::to_string(&processed_memos).unwrap_or_default()
    } else {
        serde_json::to_string_pretty(&processed_memos).unwrap_or_default()
    }
}

#[derive(Debug, Deserialize)]
struct MarkdownFormatArgs {
    memos: Vec<Memo>,
    #[serde(rename = "urlMode")]
    url_mode: String,
    #[serde(rename = "dateFormat")]
    date_format: String,
    minimal: bool,
}

#[tauri::command]
fn format_memos_markdown_with_options(args: MarkdownFormatArgs) -> String {
    let MarkdownFormatArgs { memos, url_mode, date_format, minimal } = args;
    let mut output = String::new();
    
    if !minimal {
        output.push_str("# Flomo 备忘录\n\n");
    }
    
    for (index, memo) in memos.iter().enumerate() {
        if minimal {
            // Minimal mode: one line per memo
            let date = if date_format.is_empty() {
                String::new()
            } else {
                format_date(&memo.created_at, &date_format)
            };
            let content = memo.content.replace('\n', " ");
            if date.is_empty() {
                output.push_str(&format!("{}|{}\n", index + 1, content));
            } else {
                output.push_str(&format!("{}|{}|{}\n", index + 1, date, content));
            }
        } else {
            // Normal mode
            if !date_format.is_empty() {
                let formatted_date = format_date(&memo.created_at, &date_format);
                output.push_str(&format!("## {}. {}\n\n", index + 1, formatted_date));
            } else {
                output.push_str(&format!("## {}\n\n", index + 1));
            }
            
            output.push_str(&format!("{}\n", memo.content.trim()));
            
            // URL handling
            match url_mode.as_str() {
                "full" => {
                    if let Some(url) = &memo.url {
                        output.push_str(&format!("**链接**: {}\n", url));
                    }
                },
                "id" => {
                    output.push_str(&format!("**ID**: {}\n", memo.slug));
                },
                _ => {} // "none" or any other value
            }
            
            // Tags
            if !memo.tags.is_empty() {
                output.push_str(&format!("**标签**: {}\n", memo.tags.join(", ")));
            }
            
            output.push_str("\n---\n\n");
        }
    }
    
    output
}

#[derive(Debug, Deserialize)]
struct TableFormatArgs {
    memos: Vec<Memo>,
    #[serde(rename = "dateFormat")]
    date_format: String,
}

#[tauri::command]
fn format_memos_table_with_options(args: TableFormatArgs) -> String {
    let TableFormatArgs { memos, date_format } = args;
    let mut output = String::from("序号 | 创建时间          | 内容预览\n");
    output.push_str(&"-".repeat(50));
    output.push('\n');
    
    for (index, memo) in memos.iter().enumerate() {
        let content_preview = memo.content
            .replace('\n', " ")
            .chars()
            .take(30)
            .collect::<String>();
        
        let date_str = if date_format.is_empty() {
            memo.created_at.split(' ').next().unwrap_or(&memo.created_at).to_string()
        } else {
            format_date(&memo.created_at, &date_format)
        };
        
        output.push_str(&format!("{:2}   | {:17} | {}\n", 
            index + 1, 
            date_str,
            if content_preview.len() >= 30 {
                format!("{}...", content_preview)
            } else {
                content_preview
            }
        ));
    }
    
    output
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Removed tauri_plugin_sql since we're using rusqlite directly
        .setup(|app| {
            let app_handle = app.handle();
            let app_data_dir = app_handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            
            // Ensure the directory exists
            std::fs::create_dir_all(&app_data_dir).ok();
            
            let db_path = app_data_dir.join("flomo.db");
            
            // Initialize database asynchronously
            let app_state = AppState {
                db: Arc::new(Mutex::new(None)),
                sync_cancelled: Arc::new(AtomicBool::new(false)),
            };
            
            app.manage(app_state);
            
            let db_state = app.state::<AppState>().db.clone();
            match Database::new(&db_path) {
                Ok(db) => {
                    let mut db_lock = db_state.lock().unwrap();
                    *db_lock = Some(db);
                    println!("Database initialized successfully");
                }
                Err(e) => {
                    eprintln!("Failed to initialize database: {}", e);
                }
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_memos,
            get_memos_page,
            get_memos_from_db,
            search_memos,
            search_memos_page,
            search_memos_from_db,
            sync_all_memos,
            cancel_sync,
            get_sync_status,
            clear_local_data,
            save_config,
            load_config,
            format_memos_json,
            format_memos_markdown,
            format_memos_table,
            format_memos_json_with_options,
            format_memos_markdown_with_options,
            format_memos_table_with_options
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Database-backed commands
#[tauri::command]
async fn get_memos_from_db(
    state: State<'_, AppState>,
    order_by: String,
    order_dir: String,
    offset: i64,
    limit: i64,
) -> Result<Vec<Memo>, String> {
    let db = {
        let db_lock = state.db.lock().unwrap();
        db_lock.as_ref().ok_or("Database not initialized")?.clone()
    };
    
    db.get_memos_page(&order_by, &order_dir, offset, limit)
}

#[tauri::command]
async fn search_memos_from_db(
    state: State<'_, AppState>,
    query: String,
    order_by: String,
    order_dir: String,
    offset: i64,
    limit: i64,
) -> Result<Vec<Memo>, String> {
    let db = {
        let db_lock = state.db.lock().unwrap();
        db_lock.as_ref().ok_or("Database not initialized")?.clone()
    };
    
    db.search_memos(&query, &order_by, &order_dir, offset, limit)
}

#[tauri::command]
async fn sync_all_memos(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    token: String,
) -> Result<(), String> {
    // Clone the database to avoid holding the lock across await
    let db = {
        let db_lock = state.db.lock().unwrap();
        db_lock.as_ref().ok_or("Database not initialized")?.clone()
    };
    
    // Reset cancellation flag
    state.sync_cancelled.store(false, Ordering::Relaxed);
    
    // Update status to syncing
    db.update_sync_status("syncing", None, None)?;
    
    let client = FlomoClient::new(token);
    let mut all_memos = Vec::new();
    let mut latest_slug: Option<String> = None;
    let mut latest_updated_at: Option<i64> = None;
    let mut seen_slugs = HashSet::new();
    let mut consecutive_empty_batches = 0;
    const MAX_ITERATIONS: usize = 100; // Safety limit to prevent infinite loops
    let mut iteration_count = 0;
    
    loop {
        iteration_count += 1;
        if iteration_count > MAX_ITERATIONS {
            println!("WARNING: Reached maximum iteration limit of {}", MAX_ITERATIONS);
            break;
        }
        // Check if sync was cancelled
        if state.sync_cancelled.load(Ordering::Relaxed) {
            db.update_sync_status("cancelled", Some(all_memos.len() as i64), None)?;
            return Err("Sync cancelled by user".to_string());
        }
        
        let params = client.get_params(latest_slug.as_deref(), latest_updated_at);
        
        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            HeaderValue::from_str(&client.token).map_err(|e| e.to_string())?,
        );

        let response = client.client
            .get(FlomoClient::URL_UPDATED)
            .headers(headers)
            .query(&params)
            .send()
            .await
            .map_err(|e| {
                let error_msg = e.to_string();
                let _ = db.update_sync_status("failed", None, Some(&error_msg));
                error_msg
            })?;

        let response_text = response.text().await.map_err(|e| e.to_string())?;
        let api_response: ApiResponse = serde_json::from_str(&response_text)
            .map_err(|e| {
                let error_msg = format!("JSON parse error: {}", e);
                let _ = db.update_sync_status("failed", None, Some(&error_msg));
                error_msg
            })?;

        if api_response.code != 0 {
            let error_msg = format!("API error: code {}", api_response.code);
            db.update_sync_status("failed", None, Some(&error_msg))?;
            return Err(error_msg);
        }

        let memos = api_response.data.unwrap_or_default();
        
        println!("API returned {} memos in this batch (iteration {})", memos.len(), iteration_count);
        
        if memos.is_empty() {
            consecutive_empty_batches += 1;
            if consecutive_empty_batches >= 2 {
                println!("No more memos to fetch after {} empty batches, ending sync", consecutive_empty_batches);
                break;
            }
        } else {
            consecutive_empty_batches = 0;
        }
        
        // Check for duplicates - if we've seen all memos in this batch before, we're looping
        let new_memos_count = memos.iter()
            .filter(|memo| !seen_slugs.contains(&memo.slug))
            .count();
        
        // Only break if we have no timestamp AND we're seeing duplicates
        // With proper timestamp, duplicates shouldn't happen
        if new_memos_count == 0 && !memos.is_empty() && latest_updated_at.is_none() {
            println!("WARNING: All {} memos in this batch are duplicates and pagination timestamp is missing.", memos.len());
            println!("This usually means we've fetched all available memos. Total unique memos: {}", seen_slugs.len());
            // Don't break immediately - the API might still have more data
            // Only break if we've seen this multiple times
            consecutive_empty_batches += 1;
            if consecutive_empty_batches >= 2 {
                println!("Breaking after {} duplicate batches to prevent infinite loop.", consecutive_empty_batches);
                break;
            }
        } else if new_memos_count > 0 {
            consecutive_empty_batches = 0;
            println!("Found {} new memos in this batch", new_memos_count);
        }
        
        // Add new slugs to our seen set
        for memo in &memos {
            seen_slugs.insert(memo.slug.clone());
        }

        let should_continue = memos.len() >= FlomoClient::LIMIT;
        
        if should_continue {
            let last_memo = &memos[memos.len() - 1];
            latest_slug = Some(last_memo.slug.clone());
            
            // Parse date format - API returns "YYYY-MM-DD HH:MM:SS" (space-separated)
            let date_str = &last_memo.updated_at;
            
            // Try multiple date formats as the API might return different formats
            let parsed = if let Ok(naive_dt) = NaiveDateTime::parse_from_str(date_str, "%Y-%m-%d %H:%M:%S") {
                Some(naive_dt)
            } else if let Ok(naive_dt) = NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S") {
                Some(naive_dt)
            } else {
                None
            };
            
            if let Some(naive_dt) = parsed {
                // Assume the date is in UTC
                let dt_utc = DateTime::<Utc>::from_naive_utc_and_offset(naive_dt, Utc);
                latest_updated_at = Some(dt_utc.timestamp());
                println!("Successfully parsed date: {} -> timestamp: {}", date_str, dt_utc.timestamp());
            } else {
                println!("ERROR: Failed to parse date format: '{}'", date_str);
                // Don't break - continue with just slug pagination
            }
            
            println!("Next page will use slug: {} and updated_at: {:?}", 
                     latest_slug.as_ref().unwrap(), latest_updated_at);
        }

        // Convert API memos to our Memo struct
        let batch: Vec<Memo> = memos.into_iter().map(|api_memo| Memo {
            slug: api_memo.slug.clone(),
            content: parse_html_to_text(&api_memo.content),
            created_at: api_memo.created_at,
            updated_at: api_memo.updated_at,
            tags: api_memo.tags,
            url: Some(format!("https://v.flomoapp.com/mine/?memo_id={}", api_memo.slug)),
        }).collect();
        
        // Save batch to database
        let batch_size = batch.len();
        db.bulk_upsert_memos(&batch)?;
        
        all_memos.extend(batch);
        
        // Log unique memos added in this batch (for debugging)
        println!("Total API calls so far: {}", all_memos.len());
        
        // Get actual count from database for accurate progress
        let db_count = db.get_memo_count().unwrap_or(0) as usize;
        
        // Emit progress event
        let progress = SyncProgress {
            total: db_count + if should_continue { batch_size } else { 0 }, // More accurate estimate
            current: db_count,
            status: "syncing".to_string(),
            message: format!("Synced {} unique memos...", db_count),
        };
        
        app.emit("sync-progress", &progress)
            .map_err(|e| format!("Failed to emit progress: {}", e))?;
        
        if !should_continue {
            break;
        }
    }
    
    // Get final count from database
    let final_count = db.get_memo_count().unwrap_or(0);
    
    println!("Sync completed: {} iterations, {} total API records fetched, {} unique slugs seen, {} unique memos in database", 
             iteration_count, all_memos.len(), seen_slugs.len(), final_count);
    
    // Update sync status to completed
    db.update_sync_status("completed", Some(final_count), None)?;
    
    // Emit completion event
    let progress = SyncProgress {
        total: final_count as usize,
        current: final_count as usize,
        status: "completed".to_string(),
        message: format!("Successfully synced {} unique memos", final_count),
    };
    
    app.emit("sync-progress", &progress)
        .map_err(|e| format!("Failed to emit completion: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn get_sync_status(state: State<'_, AppState>) -> Result<db::SyncStatus, String> {
    let db = {
        let db_lock = state.db.lock().unwrap();
        db_lock.as_ref().ok_or("Database not initialized")?.clone()
    };
    
    db.get_sync_status()
}

#[tauri::command]
async fn clear_local_data(state: State<'_, AppState>) -> Result<(), String> {
    let db = {
        let db_lock = state.db.lock().unwrap();
        db_lock.as_ref().ok_or("Database not initialized")?.clone()
    };
    
    db.clear_all_memos()
}

#[tauri::command]
async fn cancel_sync(state: State<'_, AppState>) -> Result<(), String> {
    state.sync_cancelled.store(true, Ordering::Relaxed);
    Ok(())
}