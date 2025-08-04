import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { RefreshCw, Settings, Search, List, Download, Info } from "lucide-react";
import { SyncModal } from "./SyncModal";
import { ExportPreview } from "./ExportPreview";
import { MemoContent } from "./MemoContent";
import { UpdateDialog } from "./UpdateDialog";
import { UpdateSettings } from "./UpdateSettings";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Memo {
  slug: string;
  content: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  url?: string;
}

type ViewMode = "list" | "search" | "settings";
type OrderBy = "created_at" | "updated_at";
type OrderDir = "asc" | "desc";

function App() {
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [orderBy, setOrderBy] = useState<OrderBy>("created_at");
  const [orderDir, setOrderDir] = useState<OrderDir>("desc");
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showExportPreview, setShowExportPreview] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [exportMemos, setExportMemos] = useState<Memo[]>([]);
  const [hasLocalData, setHasLocalData] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const { updateAvailable } = useAutoUpdate();

  // Load saved token and check for local data on mount
  useEffect(() => {
    loadToken();
    checkLocalData();
    
    // Listen for update available event from settings
    const handleUpdateAvailable = () => {
      setShowUpdateDialog(true);
    };
    
    window.addEventListener('update-available', handleUpdateAvailable);
    return () => {
      window.removeEventListener('update-available', handleUpdateAvailable);
    };
  }, []);

  const loadToken = async () => {
    try {
      const savedToken = await invoke<string | null>("load_config");
      if (savedToken) {
        setToken(savedToken);
      }
    } catch (err) {
      console.error("Failed to load token:", err);
    }
  };

  const saveToken = async () => {
    try {
      await invoke("save_config", { token });
      setError(null);
      alert("Token saved successfully!");
    } catch (err) {
      setError(`Failed to save token: ${err}`);
    }
  };

  const checkLocalData = async () => {
    try {
      const status = await invoke<any>("get_sync_status");
      setHasLocalData(status.total_memos > 0);
    } catch (err) {
      console.error("Failed to check local data:", err);
    }
  };

  // Infinite query for memos list
  const {
    data: memosData,
    fetchNextPage: fetchNextMemos,
    hasNextPage: hasNextMemos,
    isFetchingNextPage: isFetchingNextMemos,
    isLoading: isLoadingMemos,
    isError: isErrorMemos,
    error: memosError,
    refetch: refetchMemos,
  } = useInfiniteQuery({
    queryKey: ["memos", token, orderBy, orderDir, hasLocalData],
    queryFn: async ({ pageParam = 0 }) => {
      if (!token) throw new Error("No token configured");
      
      if (!hasLocalData) {
        // If no local data, show empty and prompt for sync
        return { memos: [], has_more: false };
      }
      
      const limit = 50;
      const memos = await invoke<Memo[]>("get_memos_from_db", {
        orderBy,
        orderDir,
        offset: pageParam,
        limit: limit + 1, // Get one extra to check if there's more
      });
      
      const hasMore = memos.length > limit;
      if (hasMore) {
        memos.pop(); // Remove the extra item
      }
      
      return {
        memos,
        has_more: hasMore,
        offset: pageParam,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage: any) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + 50;
    },
    enabled: viewMode === "list" && !!token && hasLocalData,
  });

  // Infinite query for search
  const {
    data: searchData,
    fetchNextPage: fetchNextSearch,
    hasNextPage: hasNextSearch,
    isFetchingNextPage: isFetchingNextSearch,
    isLoading: isLoadingSearch,
    isError: isErrorSearch,
    error: searchError,
  } = useInfiniteQuery({
    queryKey: ["search", token, searchQuery, orderBy, orderDir, hasLocalData],
    queryFn: async ({ pageParam = 0 }) => {
      if (!token) throw new Error("No token configured");
      if (!hasLocalData) return { memos: [], has_more: false };
      
      const limit = 50;
      const memos = await invoke<Memo[]>("search_memos_from_db", {
        query: searchQuery,
        orderBy,
        orderDir,
        offset: pageParam,
        limit: limit + 1,
      });
      
      const hasMore = memos.length > limit;
      if (hasMore) {
        memos.pop();
      }
      
      return {
        memos,
        has_more: hasMore,
        offset: pageParam,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage: any) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + 50;
    },
    enabled: viewMode === "search" && !!token && searchQuery.trim().length > 0 && hasLocalData,
  });

  // Set up intersection observer for infinite scrolling
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          if (viewMode === "list" && hasNextMemos && !isFetchingNextMemos) {
            fetchNextMemos();
          } else if (viewMode === "search" && hasNextSearch && !isFetchingNextSearch) {
            fetchNextSearch();
          }
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [
    viewMode,
    hasNextMemos,
    hasNextSearch,
    isFetchingNextMemos,
    isFetchingNextSearch,
    fetchNextMemos,
    fetchNextSearch,
  ]);

  const getAllMemos = useCallback(() => {
    if (viewMode === "list") {
      return memosData?.pages.flatMap((page) => page.memos) || [];
    } else {
      return searchData?.pages.flatMap((page) => page.memos) || [];
    }
  }, [memosData, searchData, viewMode]);

  const showExportDialog = async () => {
    // For export, fetch all memos from local database
    try {
      if (!hasLocalData) {
        alert("No local data to export. Please sync first.");
        return;
      }
      
      const allMemos = await invoke<Memo[]>("get_memos_from_db", {
        orderBy: "created_at",
        orderDir: "desc",
        offset: 0,
        limit: 999999, // Get all
      });
      
      if (allMemos.length === 0) {
        alert("No memos to export");
        return;
      }

      setExportMemos(allMemos);
      setShowExportPreview(true);
    } catch (err) {
      setError(`Failed to load memos: ${err}`);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "yyyy-MM-dd HH:mm");
    } catch {
      return dateStr;
    }
  };

  const renderMemo = (memo: Memo, index: number) => (
    <Card key={memo.slug} className="bg-card hover:bg-popover hover:shadow-xl transition-all duration-300 border-0 shadow-md overflow-hidden group">
      <div className="absolute top-0 left-0 w-1 h-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity"></div>
      <CardHeader className="pb-3 bg-gradient-to-r from-transparent to-muted/20">
        <div className="flex justify-between items-center text-sm">
          <span className="font-bold text-primary text-base">#{index + 1}</span>
          <span className="text-muted-foreground text-xs">{formatDate(memo.created_at)}</span>
        </div>
      </CardHeader>
      <CardContent className="pb-3 px-6">
        <div className="prose prose-sm max-w-none">
          <MemoContent content={memo.content} />
        </div>
        {memo.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {memo.tags.map((tag, i) => (
              <Badge key={i} variant="secondary" className="text-xs px-3 py-1 bg-secondary/50 hover:bg-secondary transition-colors">
                #{tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
      {memo.url && (
        <CardFooter className="pt-3 border-t border-border/50 bg-muted/20">
          <a 
            href={memo.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-sm text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
          >
            View on Flomo
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </a>
        </CardFooter>
      )}
    </Card>
  );

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    setError(null);
  };

  const handleSyncComplete = () => {
    checkLocalData();
    queryClient.invalidateQueries();
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="relative bg-gradient-to-r from-primary via-primary/90 to-[#CC785C] shadow-lg">
        <div className="absolute inset-0 bg-black/5"></div>
        <div className="container mx-auto px-4 py-5 flex items-center justify-between relative">
          <h1 className="text-3xl font-bold text-white tracking-tight">Flomo Garden</h1>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="default"
              onClick={() => setShowSyncModal(true)}
              className="gap-2 shadow-md hover:shadow-lg transition-all"
            >
              <RefreshCw className="h-4 w-4" />
              Sync Data
            </Button>
            <Button
              variant="secondary"
              size="default"
              onClick={() => setShowUpdateDialog(true)}
              className="gap-2 shadow-md hover:shadow-lg transition-all relative"
            >
              <Info className="h-4 w-4" />
              Updates
              {updateAvailable && (
                <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full animate-pulse" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <Tabs value={viewMode} onValueChange={(v) => handleViewModeChange(v as ViewMode)} className="h-full">
          <div className="bg-muted/30 border-b">
            <div className="container mx-auto px-4 py-3">
              <TabsList className="grid w-full max-w-md grid-cols-3 mx-auto bg-background shadow-inner p-1">
                <TabsTrigger value="list" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                  <List className="h-4 w-4" />
                  <span className="font-medium">Memos</span>
                </TabsTrigger>
                <TabsTrigger value="search" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                  <Search className="h-4 w-4" />
                  <span className="font-medium">Search</span>
                </TabsTrigger>
                <TabsTrigger value="settings" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all">
                  <Settings className="h-4 w-4" />
                  <span className="font-medium">Settings</span>
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          <ScrollArea className="h-[calc(100vh-8rem)]">
            <div className="container mx-auto px-4 py-6">
              {error && (
                <div className="mb-4 p-4 bg-destructive/10 text-destructive rounded-lg">
                  {error}
                </div>
              )}

              <TabsContent value="settings" className="space-y-4 mt-0">
                <Card className="max-w-2xl mx-auto border-0 shadow-lg bg-card">
                  <CardHeader className="bg-gradient-to-r from-primary/10 to-transparent pb-6">
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-[#CC785C] bg-clip-text text-transparent">Configuration</h2>
                    <p className="text-muted-foreground text-sm mt-1">Manage your Flomo connection settings</p>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-6">
                    <div className="space-y-3">
                      <Label htmlFor="token" className="text-base font-medium">Bearer Token</Label>
                      <Input
                        id="token"
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Enter your Flomo Bearer token"
                        className="h-12 text-base border-2 focus:border-primary transition-colors"
                      />
                      <Button onClick={saveToken} className="w-full sm:w-auto bg-primary hover:bg-primary/90 shadow-md hover:shadow-lg transition-all">
                        <Settings className="h-4 w-4 mr-2" />
                        Save Token
                      </Button>
                    </div>
                    <Card className="bg-muted/50 border-dashed border-2 border-muted-foreground/20">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                          <div className="rounded-full bg-primary/10 p-2">
                            <Settings className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-medium mb-3">How to get your Bearer token:</p>
                            <ol className="list-decimal list-inside text-sm space-y-2 text-muted-foreground">
                              <li>Open Flomo web app in your browser</li>
                              <li>Open Developer Tools (Press F12)</li>
                              <li>Navigate to the Network tab</li>
                              <li>Refresh the page</li>
                              <li>Look for API requests and find the Authorization header</li>
                              <li>Copy the Bearer token value</li>
                            </ol>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </CardContent>
                </Card>
                
                <UpdateSettings />
              </TabsContent>

              <TabsContent value="list" className="space-y-4 mt-0">
                {!token ? (
                  <Card className="max-w-md mx-auto">
                    <CardContent className="pt-6 text-center">
                      <p className="text-muted-foreground">Please configure your token in Settings first.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="orderBy" className="text-sm">Sort by:</Label>
                        <Select value={orderBy} onValueChange={(v) => setOrderBy(v as OrderBy)}>
                          <SelectTrigger id="orderBy" className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="created_at">Created Date</SelectItem>
                            <SelectItem value="updated_at">Updated Date</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={orderDir} onValueChange={(v) => setOrderDir(v as OrderDir)}>
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="desc">Newest First</SelectItem>
                            <SelectItem value="asc">Oldest First</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          onClick={showExportDialog}
                          disabled={!hasLocalData}
                          variant="secondary"
                          size="sm"
                          className="gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Export All
                        </Button>
                        {isErrorMemos && (
                          <Button onClick={() => refetchMemos()} size="sm">
                            Retry
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {!hasLocalData && (
                      <Card className="bg-muted">
                        <CardContent className="pt-6 text-center space-y-4">
                          <p className="text-muted-foreground">No local data found. Please sync your memos first.</p>
                          <Button onClick={() => setShowSyncModal(true)}>
                            Open Sync Manager
                          </Button>
                        </CardContent>
                      </Card>
                    )}
                    
                    {hasLocalData && getAllMemos().length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Showing: {getAllMemos().length} memos (sorted by {orderBy === "created_at" ? "creation date" : "update date"})
                        {!hasNextMemos && (
                          <span className="italic"> • All loaded</span>
                        )}
                      </p>
                    )}

                    <div className="grid gap-4">
                      {isLoadingMemos && (
                        <div className="text-center py-8 text-muted-foreground">Loading memos...</div>
                      )}
                      
                      {isErrorMemos && (
                        <Card className="bg-destructive/10">
                          <CardContent className="pt-6">
                            <p className="text-destructive">
                              Failed to load memos: {memosError?.message || "Unknown error"}
                            </p>
                          </CardContent>
                        </Card>
                      )}
                      
                      {!isLoadingMemos && !isErrorMemos && hasLocalData && getAllMemos().length === 0 && (
                        <Card>
                          <CardContent className="pt-6 text-center">
                            <p className="text-muted-foreground">No memos found.</p>
                          </CardContent>
                        </Card>
                      )}
                      
                      {getAllMemos().map((memo, index) => renderMemo(memo, index))}
                      
                      {(hasNextMemos || isFetchingNextMemos) && (
                        <div ref={loadMoreRef} className="text-center py-4">
                          {isFetchingNextMemos ? (
                            <div className="text-muted-foreground">Loading more...</div>
                          ) : (
                            <div className="text-muted-foreground text-sm opacity-60">Scroll for more</div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="search" className="space-y-4 mt-0">
                <div className="space-y-4">
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search memos..."
                    className="max-w-2xl mx-auto"
                  />

                  {searchQuery.trim() && (
                    <div className="flex items-center gap-2 max-w-2xl mx-auto">
                      <Label htmlFor="searchOrderBy" className="text-sm">Sort by:</Label>
                      <Select value={orderBy} onValueChange={(v) => setOrderBy(v as OrderBy)}>
                        <SelectTrigger id="searchOrderBy" className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="created_at">Created Date</SelectItem>
                          <SelectItem value="updated_at">Updated Date</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={orderDir} onValueChange={(v) => setOrderDir(v as OrderDir)}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="desc">Newest First</SelectItem>
                          <SelectItem value="asc">Oldest First</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  
                  {searchQuery.trim() && hasLocalData && getAllMemos().length > 0 && (
                    <p className="text-sm text-muted-foreground text-center">
                      Found: {getAllMemos().length} memos
                    </p>
                  )}

                  <div className="grid gap-4">
                    {isLoadingSearch && (
                      <div className="text-center py-8 text-muted-foreground">Searching...</div>
                    )}
                    
                    {isErrorSearch && (
                      <Card className="bg-destructive/10">
                        <CardContent className="pt-6">
                          <p className="text-destructive">
                            Search failed: {searchError?.message || "Unknown error"}
                          </p>
                        </CardContent>
                      </Card>
                    )}
                    
                    {!isLoadingSearch && searchQuery.trim() && hasLocalData && getAllMemos().length === 0 && (
                      <Card>
                        <CardContent className="pt-6 text-center">
                          <p className="text-muted-foreground">No memos found matching "{searchQuery}"</p>
                        </CardContent>
                      </Card>
                    )}
                    
                    {!hasLocalData && searchQuery.trim() && (
                      <Card className="bg-muted">
                        <CardContent className="pt-6 text-center space-y-4">
                          <p className="text-muted-foreground">No local data found. Please sync your memos first.</p>
                          <Button onClick={() => setShowSyncModal(true)}>
                            Open Sync Manager
                          </Button>
                        </CardContent>
                      </Card>
                    )}
                    
                    {getAllMemos().map((memo, index) => renderMemo(memo, index))}
                    
                    {(hasNextSearch || isFetchingNextSearch) && (
                      <div ref={loadMoreRef} className="text-center py-4">
                        {isFetchingNextSearch ? (
                          <div className="text-muted-foreground">Loading more...</div>
                        ) : (
                          <div className="text-muted-foreground text-sm opacity-60">Scroll for more</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </main>
      
      <SyncModal
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
        token={token}
        onSyncComplete={handleSyncComplete}
      />
      
      {showExportPreview && exportMemos.length > 0 && (
        <ExportPreview
          memos={exportMemos}
          onClose={() => setShowExportPreview(false)}
        />
      )}
      
      <UpdateDialog
        open={showUpdateDialog}
        onOpenChange={setShowUpdateDialog}
      />
    </div>
  );
}

export default App;
