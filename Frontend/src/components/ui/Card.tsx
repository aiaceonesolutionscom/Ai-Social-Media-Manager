import { cn } from '../../utils/cn';

interface CardProps {
  as?: 'div' | 'section' | 'article' | 'li';
  hoverable?: boolean;
  padded?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function Card({
  as: Tag = 'div',
  hoverable = true,
  padded = true,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Tag
      className={cn(
        'bg-white rounded-2xl border border-slate-200 shadow-sm transition-all duration-200',
        'dark:bg-slate-900 dark:border-slate-800',
        hoverable && 'hover:shadow-md hover:-translate-y-0.5',
        padded && 'p-6',
        className
      )}
      {...props}>
      
      {children}
    </Tag>);

}

export function CardHeader({
  title,
  description,
  action
}: {title: string;description?: string;action?: React.ReactNode;}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">{title}</h3>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {action}
    </div>);

}
