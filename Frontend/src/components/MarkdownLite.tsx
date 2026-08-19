import React from 'react';

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b-${i}`}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      nodes.push(<em key={`${keyPrefix}-i-${i}`}>{part.slice(1, -1)}</em>);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      nodes.push(
        <code
          key={`${keyPrefix}-c-${i}`}
          className="rounded bg-slate-200/80 px-1 py-0.5 text-[0.85em] dark:bg-slate-700"
        >
          {part.slice(1, -1)}
        </code>,
      );
    } else if (part) {
      nodes.push(part);
    }
  });
  return nodes;
}

export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1.5" />;
        if (trimmed.startsWith('• ') || trimmed.startsWith('- ')) {
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span>•</span>
              <span>{renderInline(trimmed.slice(2), `li-${i}`)}</span>
            </div>
          );
        }
        if (/^#+\s/.test(trimmed)) {
          return (
            <div key={i} className="text-sm font-semibold">
              {renderInline(trimmed.replace(/^#+\s/, ''), `h-${i}`)}
            </div>
          );
        }
        if (trimmed.startsWith('> ')) {
          return (
            <div
              key={i}
              className="border-l-2 border-slate-300 pl-2 italic opacity-90 dark:border-slate-600"
            >
              {renderInline(trimmed.slice(2), `q-${i}`)}
            </div>
          );
        }
        return <div key={i}>{renderInline(line, `p-${i}`)}</div>;
      })}
    </>
  );
}