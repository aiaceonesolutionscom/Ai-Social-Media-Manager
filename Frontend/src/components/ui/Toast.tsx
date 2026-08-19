
import { Toaster, toast } from 'sonner';

/**
 * Global toast host. Toasts slide in from the top-right.
 * Trigger with `notify.success('...')` from anywhere.
 */
export function ToastHost() {
  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
          'rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-md dark:bg-slate-900 dark:border-slate-800 dark:text-slate-100',
          title: 'font-semibold text-sm',
          description: 'text-sm text-slate-500'
        }
      }} />);


}

export const notify = {
  success: (message: string, description?: string) => toast.success(message, { description }),
  error: (message: string, description?: string) => toast.error(message, { description }),
  info: (message: string, description?: string) => toast(message, { description }),
  loading: (message: string) => toast.loading(message),
  dismiss: (id?: string | number) => toast.dismiss(id)
};