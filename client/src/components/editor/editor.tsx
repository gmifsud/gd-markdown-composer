import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Loader2, Save, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUpdateDocument } from "@/hooks/use-documents";
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import { type DocumentResponse } from "@shared/routes";

interface EditorProps {
  document: DocumentResponse;
}

export function Editor({ document }: EditorProps) {
  const [content, setContent] = useState(document.content || "");
  const [title, setTitle] = useState(document.title || "");
  const [isDirty, setIsDirty] = useState(false);

  const updateMutation = useUpdateDocument();
  const { toast } = useToast();
  
  // Debounce typed inputs for auto-saving
  const debouncedContent = useDebounce(content, 1000);
  const debouncedTitle = useDebounce(title, 1000);

  // Sync internal state when document ID changes
  useEffect(() => {
    setContent(document.content || "");
    setTitle(document.title || "");
    setIsDirty(false);
  }, [document.id]);

  // Track if changes exist to display "Unsaved" indicator
  useEffect(() => {
    if (content !== document.content || title !== document.title) {
      setIsDirty(true);
    } else {
      setIsDirty(false);
    }
  }, [content, title, document.content, document.title]);

  // Execute Auto-save
  useEffect(() => {
    if (debouncedContent !== document.content || debouncedTitle !== document.title) {
      updateMutation.mutate({ 
        id: document.id, 
        content: debouncedContent, 
        title: debouncedTitle 
      }, {
        onSuccess: () => setIsDirty(false)
      });
    }
  }, [debouncedContent, debouncedTitle]);

  const handleManualSave = () => {
    updateMutation.mutate({
      id: document.id,
      content,
      title
    }, {
      onSuccess: () => setIsDirty(false)
    });
  };

  const handleSaveAs = () => {
    try {
      const filename = title.trim() || "document";
      const element = window.document.createElement("a");
      element.setAttribute("href", `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`);
      element.setAttribute("download", `${filename}.md`);
      element.style.display = "none";
      window.document.body.appendChild(element);
      element.click();
      window.document.body.removeChild(element);
      toast({ description: `Downloaded "${filename}.md"` });
    } catch (err) {
      toast({ 
        description: "Failed to download file", 
        variant: "destructive" 
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white shadow-sm ring-1 ring-black/[0.03] z-10 m-0 md:m-4 md:rounded-2xl overflow-hidden">
      {/* Editor Header */}
      <div className="h-16 border-b border-gray-100 flex items-center px-4 md:px-8 justify-between bg-white shrink-0">
        <input 
          value={title} 
          onChange={e => setTitle(e.target.value)} 
          className="font-bold text-lg md:text-xl focus:outline-none bg-transparent placeholder:text-gray-300 text-gray-900 w-1/2 tracking-tight"
          placeholder="Untitled Document"
        />
        <div className="flex items-center gap-3 md:gap-5">
          <span className="text-[11px] md:text-xs font-medium text-gray-400 flex items-center gap-1.5 md:gap-2">
            {updateMutation.isPending ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> <span className="hidden md:inline">Saving...</span></>
            ) : isDirty ? (
              <><div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" /> <span className="hidden md:inline">Unsaved</span></>
            ) : (
              <><Check className="w-3.5 h-3.5 text-green-500" /> <span className="hidden md:inline">Saved</span></>
            )}
          </span>
          <Button 
            size="sm" 
            variant="secondary"
            onClick={handleSaveAs}
            className="h-8 rounded-full px-3 md:px-5 text-xs font-semibold transition-all shadow-sm hidden sm:flex"
            data-testid="button-save-as"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Save As
          </Button>
          <Button 
            size="sm" 
            variant={isDirty ? "default" : "secondary"}
            onClick={handleManualSave}
            disabled={!isDirty || updateMutation.isPending}
            className="h-8 rounded-full px-3 md:px-5 text-xs font-semibold transition-all shadow-sm hidden sm:flex"
            data-testid="button-save"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            Save
          </Button>
        </div>
      </div>

      {/* Editor Body - Split Desktop / Tabbed Mobile */}
      <div className="flex-1 flex flex-col min-h-0 bg-white">
        
        {/* DESKTOP SPLIT VIEW */}
        <div className="hidden md:flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-h-0 border-r border-gray-100/80 group">
            <div className="h-10 border-b border-gray-50 flex items-center px-6 bg-[#fcfcfc] shrink-0 text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
              Markdown
            </div>
            <textarea
              className="flex-1 resize-none p-6 md:p-8 font-mono text-[13px] leading-relaxed focus:outline-none bg-transparent placeholder:text-gray-200 text-gray-700 transition-colors"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Start writing markdown..."
              spellCheck={false}
            />
          </div>
          
          <div className="flex-1 flex flex-col min-h-0 bg-[#fafafa]">
            <div className="h-10 border-b border-gray-50 flex items-center px-6 bg-[#fcfcfc] shrink-0 text-[10px] font-semibold tracking-widest text-gray-400 uppercase">
              Preview
            </div>
            <div className="flex-1 overflow-y-auto p-6 md:p-8">
              <div className="prose prose-sm md:prose-base prose-slate max-w-[80ch] prose-headings:tracking-tight prose-a:text-blue-600 prose-pre:bg-gray-900 prose-pre:text-gray-100">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content || "*Nothing to preview*"}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>

        {/* MOBILE TABBED VIEW */}
        <div className="flex flex-1 flex-col min-h-0 md:hidden bg-white">
          <Tabs defaultValue="markdown" className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-gray-100 bg-[#fafafa] shrink-0">
              <TabsList className="grid w-full grid-cols-2 bg-gray-200/50 p-1">
                <TabsTrigger value="markdown" className="text-xs rounded shadow-sm data-[state=active]:bg-white">Write</TabsTrigger>
                <TabsTrigger value="preview" className="text-xs rounded shadow-sm data-[state=active]:bg-white">Preview</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="markdown" className="flex-1 p-0 m-0 data-[state=active]:flex flex-col min-h-0">
              <textarea
                className="flex-1 resize-none p-5 font-mono text-[13px] leading-relaxed focus:outline-none bg-transparent placeholder:text-gray-300 text-gray-700"
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Start writing..."
                spellCheck={false}
              />
            </TabsContent>
            <TabsContent value="preview" className="flex-1 overflow-y-auto p-5 m-0 data-[state=active]:block min-h-0 bg-[#fafafa]">
              <div className="prose prose-sm prose-slate max-w-none prose-headings:tracking-tight">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content || "*Nothing to preview*"}
                </ReactMarkdown>
              </div>
            </TabsContent>
          </Tabs>
        </div>
        
      </div>
    </div>
  );
}
