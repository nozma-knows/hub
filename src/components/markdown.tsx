"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";

import { cn } from "@/lib/utils";

// Tight, safe schema: allow common formatting + code + tables.
const markdownSchema = {
  ...defaultSchema,
  // Ensure className survives on code spans for syntax highlighting.
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className"]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className"]]
  }
} as const;

export function MarkdownMessage({ body, className }: { body: string; className?: string }) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed break-words [overflow-wrap:anywhere]",
        // basic markdown element styling
        "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_h1]:my-3 [&_h1]:text-lg [&_h1]:font-semibold",
        "[&_h2]:my-3 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:my-2 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_ul]:my-2 [&_ul]:ml-5 [&_ul]:list-disc",
        "[&_ol]:my-2 [&_ol]:ml-5 [&_ol]:list-decimal",
        "[&_li]:my-1",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:opacity-90",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
        "[&_pre]:my-2 [&_pre]:max-h-[40vh] [&_pre]:overflow-auto [&_pre]:overscroll-contain [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted/40 [&_pre]:p-3 [&_pre]:max-w-full",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px]",
        "[&_table]:max-w-full",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, markdownSchema], rehypeHighlight]}
        // Never render raw HTML from message bodies.
        skipHtml
        components={{
          pre: ({ children, ...props }) => (
            <pre
              {...props}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              {children}
            </pre>
          ),
          code: ({ children, ...props }) => (
            <code
              {...props}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {children}
            </code>
          ),
          table: ({ children, ...props }) => (
            <div className="my-2 overflow-x-auto rounded-md border" onClick={(e) => e.stopPropagation()}>
              <table className="min-w-[520px] w-full text-xs" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="bg-muted/40" {...props}>
              {children}
            </thead>
          ),
          th: ({ children, ...props }) => (
            <th className="border-b px-2 py-1 text-left font-medium" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border-b px-2 py-1 align-top" {...props}>
              {children}
            </td>
          )
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
