import React from 'react';
import { cn } from '../../utils/cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  mono?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
{ label, error, hint, mono, className, id, ...props },
ref)
{
  const reactId = React.useId();
  const inputId = id ?? reactId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="w-full">
      {label &&
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          {label}
        </label>
      }
      <input
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'w-full h-11 rounded-xl border bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400',
          'transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100',
          'dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-indigo-900/40',
          error ? 'border-red-400' : 'border-slate-200 dark:border-slate-700',
          mono && 'font-mono',
          className
        )}
        {...props} />
      
      {error ?
      <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p> :
      hint ?
      <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p> :
      null}
    </div>);

});

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
{ label, error, className, id, ...props },
ref)
{
  const reactId = React.useId();
  const inputId = id ?? reactId;
  return (
    <div className="w-full">
      {label &&
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          {label}
        </label>
      }
      <textarea
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={cn(
          'w-full min-h-[96px] rounded-xl border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400',
          'transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100',
          'dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-900/40',
          error ? 'border-red-400' : 'border-slate-200 dark:border-slate-700',
          className
        )}
        {...props} />
      
      {error &&
      <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      }
    </div>);

});