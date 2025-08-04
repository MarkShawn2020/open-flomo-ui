import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./SyncModal.css";

interface SyncProgress {
  total: number;
  current: number;
  status: string;
  message: string;
}

interface SyncStatus {
  id: number;
  last_sync_at: string | null;
  total_memos: number;
  status: string;
  error_message: string | null;
}

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  onSyncComplete: () => void;
}

export function SyncModal({ isOpen, onClose, token, onSyncComplete }: SyncModalProps) {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [issyncing, setIsSyncing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSyncStatus();
    }
  }, [isOpen]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    if (isOpen) {
      // Listen for sync progress events
      listen<SyncProgress>("sync-progress", (event) => {
        setProgress(event.payload);
        if (event.payload.status === "completed" || event.payload.status === "cancelled") {
          setIsSyncing(false);
          setIsCancelling(false);
          loadSyncStatus();
          if (event.payload.status === "completed") {
            onSyncComplete();
          }
        }
      }).then((unlistenFn) => {
        unlisten = unlistenFn;
      });
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [isOpen, onSyncComplete]);

  const loadSyncStatus = async () => {
    try {
      const status = await invoke<SyncStatus>("get_sync_status");
      setSyncStatus(status);
    } catch (err) {
      console.error("Failed to load sync status:", err);
    }
  };

  const startSync = async () => {
    if (!token || issyncing) return;

    setIsSyncing(true);
    setProgress({
      total: 0,
      current: 0,
      status: "starting",
      message: "Starting synchronization...",
    });

    try {
      await invoke("sync_all_memos", { token });
    } catch (err) {
      const errorMessage = String(err);
      if (errorMessage.includes("cancelled")) {
        setProgress({
          total: progress?.total || 0,
          current: progress?.current || 0,
          status: "cancelled",
          message: "Sync cancelled by user",
        });
      } else {
        setProgress({
          total: 0,
          current: 0,
          status: "failed",
          message: `Sync failed: ${err}`,
        });
      }
      setIsSyncing(false);
      setIsCancelling(false);
      loadSyncStatus();
    }
  };

  const cancelSync = async () => {
    if (!issyncing || isCancelling) return;
    
    setIsCancelling(true);
    try {
      await invoke("cancel_sync");
    } catch (err) {
      console.error("Failed to cancel sync:", err);
      setIsCancelling(false);
    }
  };

  const clearData = async () => {
    if (issyncing) return;

    if (confirm("Are you sure you want to clear all local data? This cannot be undone.")) {
      try {
        await invoke("clear_local_data");
        setSyncStatus(null);
        setProgress(null);
        loadSyncStatus();
        onSyncComplete();
      } catch (err) {
        alert(`Failed to clear data: ${err}`);
      }
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const getProgressPercentage = () => {
    if (!progress || progress.total === 0) return 0;
    return Math.round((progress.current / progress.total) * 100);
  };

  if (!isOpen) return null;

  return (
    <div className="sync-modal-overlay" onClick={onClose}>
      <div className="sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sync-modal-header">
          <h2>Data Synchronization</h2>
          <button className="close-button" onClick={onClose} disabled={issyncing && !isCancelling}>
            ×
          </button>
        </div>

        <div className="sync-modal-content">
          {syncStatus && (
            <div className="sync-info">
              <div className="info-row">
                <span>Last sync:</span>
                <span>{formatDate(syncStatus.last_sync_at)}</span>
              </div>
              <div className="info-row">
                <span>Total memos:</span>
                <span>{syncStatus.total_memos}</span>
              </div>
              {syncStatus.error_message && (
                <div className="error-info">
                  <span>Last error:</span>
                  <span>{syncStatus.error_message}</span>
                </div>
              )}
            </div>
          )}

          {progress && (
            <div className="sync-progress">
              <div className="progress-message">{progress.message}</div>
              {progress.status === "syncing" && (
                <>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${getProgressPercentage()}%` }}
                    />
                  </div>
                  <div className="progress-stats">
                    {progress.current} / {progress.total} ({getProgressPercentage()}%)
                  </div>
                </>
              )}
              {progress.status === "failed" && (
                <div className="progress-error">{progress.message}</div>
              )}
              {progress.status === "completed" && (
                <div className="progress-success">✓ {progress.message}</div>
              )}
              {progress.status === "cancelled" && (
                <div className="progress-error">⚠️ {progress.message}</div>
              )}
            </div>
          )}

          <div className="sync-actions">
            {!issyncing && (
              <>
                <button
                  className="sync-button primary"
                  onClick={startSync}
                  disabled={!token}
                >
                  {syncStatus?.last_sync_at ? "Sync Again" : "Start Initial Sync"}
                </button>
                <button
                  className="sync-button secondary"
                  onClick={clearData}
                >
                  Clear Local Data
                </button>
              </>
            )}
            {issyncing && (
              <>
                <button 
                  className="sync-button secondary" 
                  onClick={cancelSync}
                  disabled={isCancelling}
                >
                  {isCancelling ? "Cancelling..." : "Cancel Sync"}
                </button>
              </>
            )}
          </div>

          <div className="sync-help">
            <p>
              Synchronization will download all your Flomo memos to local storage
              for faster access and offline viewing.
            </p>
            {!token && (
              <p className="warning">
                Please configure your Bearer token in Settings first.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}