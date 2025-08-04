import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';

interface MemoContentProps {
  content: string;
}

export const MemoContent: React.FC<MemoContentProps> = ({ content }) => {
  const components: Partial<Components> = {
    // Custom link renderer to open external links in new tab
    a: ({ node, ...props }) => (
      <a {...props} target="_blank" rel="noopener noreferrer" />
    ),
    // Custom code block renderer
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <div className="relative">
          <div className="absolute top-0 right-0 px-2 py-1 text-xs text-gray-400 bg-gray-800 rounded-bl">{match[1]}</div>
          <code className={className} {...props}>
            {children}
          </code>
        </div>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    // Custom table renderer
    table: ({ node, ...props }) => (
      <div className="overflow-x-auto">
        <table {...props} />
      </div>
    ),
    // Custom image renderer
    img: ({ node, ...props }) => (
      <img loading="lazy" {...props} />
    ),
  };

  return (
    <div className="prose prose-sm max-w-none 
      prose-headings:text-foreground 
      prose-p:text-foreground 
      prose-strong:text-foreground 
      prose-a:text-primary hover:prose-a:text-primary/80
      prose-blockquote:border-primary prose-blockquote:bg-muted/50 prose-blockquote:text-muted-foreground
      prose-code:text-foreground prose-code:bg-muted prose-code:rounded prose-code:px-1 prose-code:py-0.5
      prose-pre:bg-[#0d1117] prose-pre:text-[#f8f8f2]
      prose-th:bg-muted prose-th:text-foreground
      prose-tr:border-border
      prose-img:rounded-lg prose-img:shadow-md
      prose-hr:border-border">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};