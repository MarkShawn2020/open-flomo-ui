import { useState, useEffect } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Info, RefreshCw } from 'lucide-react';
import { check } from '@tauri-apps/plugin-updater';

const STORE_NAME = 'flomo-garden-settings.json';

export function UpdateSettings() {
  const [autoCheck, setAutoCheck] = useState(true);
  const [checkInterval, setCheckInterval] = useState('hourly');
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const store = await load(STORE_NAME, { autoSave: true });
      
      const autoCheckValue = await store.get<boolean>('autoCheckUpdates');
      if (autoCheckValue !== null && autoCheckValue !== undefined) {
        setAutoCheck(autoCheckValue);
      }
      
      const intervalValue = await store.get<string>('updateCheckInterval');
      if (intervalValue) {
        setCheckInterval(intervalValue);
      }
      
      const lastCheckTime = await store.get<number>('lastUpdateCheck');
      if (lastCheckTime) {
        setLastCheck(new Date(lastCheckTime));
      }
    } catch (error) {
      console.error('Failed to load update settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      const store = await load(STORE_NAME, { autoSave: true });
      
      await store.set('autoCheckUpdates', autoCheck);
      await store.set('updateCheckInterval', checkInterval);
      await store.save();
    } catch (error) {
      console.error('Failed to save update settings:', error);
    }
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      const update = await check();
      const now = new Date();
      setLastCheck(now);
      
      const store = await load(STORE_NAME, { autoSave: true });
      await store.set('lastUpdateCheck', now.getTime());
      await store.save();
      
      if (update) {
        // The UpdateDialog will handle showing the update
        window.dispatchEvent(new CustomEvent('update-available'));
      } else {
        alert('You are running the latest version!');
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      alert('Failed to check for updates. Please try again later.');
    } finally {
      setChecking(false);
    }
  };

  const formatLastCheck = () => {
    if (!lastCheck) return 'Never';
    
    const now = new Date();
    const diff = now.getTime() - lastCheck.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  return (
    <Card className="max-w-2xl mx-auto border-0 shadow-lg bg-card mt-6">
      <CardHeader className="bg-gradient-to-r from-primary/10 to-transparent pb-6">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-[#CC785C] bg-clip-text text-transparent">
          Update Settings
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Configure automatic update checking
        </p>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="auto-check" className="text-base font-medium">
              Automatic Update Checks
            </Label>
            <p className="text-sm text-muted-foreground">
              Check for updates automatically in the background
            </p>
          </div>
          <Switch
            id="auto-check"
            checked={autoCheck}
            onCheckedChange={(checked) => {
              setAutoCheck(checked);
              saveSettings();
            }}
          />
        </div>

        {autoCheck && (
          <div className="space-y-3">
            <Label htmlFor="interval" className="text-base font-medium">
              Check Frequency
            </Label>
            <Select
              value={checkInterval}
              onValueChange={(value) => {
                setCheckInterval(value);
                saveSettings();
              }}
            >
              <SelectTrigger id="interval" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Every Hour</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="pt-4 border-t space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4" />
              <span>Last checked: {formatLastCheck()}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={checkNow}
              disabled={checking}
              className="gap-2"
            >
              {checking ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Check Now
                </>
              )}
            </Button>
          </div>
        </div>

        <Card className="bg-muted/50 border-dashed border-2 border-muted-foreground/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2">
                <Info className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">About Updates</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Updates are downloaded in the background</li>
                  <li>All updates are cryptographically signed for security</li>
                  <li>You can always choose when to install updates</li>
                  <li>Release notes are shown before installation</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
}