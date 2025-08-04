import { useState, useEffect } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Loader2, Download, CheckCircle, AlertCircle } from 'lucide-react';

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type UpdateStatus = 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'upToDate';

export function UpdateDialog({ open, onOpenChange }: UpdateDialogProps) {
  const [status, setStatus] = useState<UpdateStatus>('checking');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);

  useEffect(() => {
    if (open) {
      checkForUpdate();
    }
  }, [open]);

  const checkForUpdate = async () => {
    try {
      setStatus('checking');
      setError(null);
      setProgress(0);

      const updateResult = await check();
      
      if (updateResult) {
        setUpdate(updateResult);
        setStatus('available');
        setTotalBytes(0); // Size will be updated during download
      } else {
        setStatus('upToDate');
      }
    } catch (err) {
      console.error('Failed to check for updates:', err);
      setError(err instanceof Error ? err.message : 'Failed to check for updates');
      setStatus('error');
    }
  };

  const downloadAndInstall = async () => {
    if (!update) return;

    try {
      setStatus('downloading');
      setError(null);

      await update.downloadAndInstall((event: any) => {
        if (event && typeof event === 'object' && 'chunkLength' in event && 'contentLength' in event) {
          // Download progress event
          const downloaded = Number(event.chunkLength) || 0;
          const total = Number(event.contentLength) || 0;
          setDownloadedBytes(downloaded);
          setTotalBytes(total);
          if (total > 0) {
            setProgress(Math.round((downloaded / total) * 100));
          }
        }
      });

      setStatus('ready');
    } catch (err) {
      console.error('Failed to download update:', err);
      setError(err instanceof Error ? err.message : 'Failed to download update');
      setStatus('error');
    }
  };

  const restartApp = async () => {
    await relaunch();
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <div className="flex flex-col items-center py-8 space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">Checking for updates...</p>
          </div>
        );

      case 'upToDate':
        return (
          <div className="flex flex-col items-center py-8 space-y-4">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <p className="text-center">
              Your app is up to date!<br />
              <span className="text-sm text-muted-foreground">Version {update?.version || 'current'}</span>
            </p>
          </div>
        );

      case 'available':
        return (
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <Download className="h-8 w-8 text-primary" />
              <div>
                <p className="font-semibold">New version available!</p>
                <p className="text-sm text-muted-foreground">Version {update?.version}</p>
              </div>
            </div>
            {update?.body && (
              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm font-medium mb-2">What's new:</p>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {update.body}
                </div>
              </div>
            )}
            <div className="text-sm text-muted-foreground">
              Download size: {formatBytes(totalBytes)}
            </div>
          </div>
        );

      case 'downloading':
        return (
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div>
                <p className="font-semibold">Downloading update...</p>
                <p className="text-sm text-muted-foreground">
                  {formatBytes(downloadedBytes)} / {formatBytes(totalBytes)}
                </p>
              </div>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-center text-sm text-muted-foreground">{progress}%</p>
          </div>
        );

      case 'ready':
        return (
          <div className="flex flex-col items-center py-8 space-y-4">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <p className="text-center">
              Update downloaded successfully!<br />
              <span className="text-sm text-muted-foreground">Ready to restart</span>
            </p>
          </div>
        );

      case 'error':
        return (
          <div className="flex flex-col items-center py-8 space-y-4">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <p className="text-center text-red-500">
              Update failed<br />
              <span className="text-sm">{error}</span>
            </p>
          </div>
        );
    }
  };

  const renderActions = () => {
    switch (status) {
      case 'checking':
        return null;

      case 'upToDate':
      case 'error':
        return (
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        );

      case 'available':
        return (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Later
            </Button>
            <Button onClick={downloadAndInstall}>
              Download Update
            </Button>
          </>
        );

      case 'downloading':
        return (
          <Button variant="outline" disabled>
            Downloading...
          </Button>
        );

      case 'ready':
        return (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Restart Later
            </Button>
            <Button onClick={restartApp}>
              Restart Now
            </Button>
          </>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Software Update</DialogTitle>
          <DialogDescription>
            Keep your Flomo Garden up to date with the latest features and improvements.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          {renderContent()}
        </div>

        <DialogFooter>
          {renderActions()}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}