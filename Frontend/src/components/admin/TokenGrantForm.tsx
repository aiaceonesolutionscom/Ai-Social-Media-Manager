
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input, Textarea } from '../ui/Input';
import { Button } from '../ui/Button';

const schema = z.object({
  amount: z.coerce.number().int('Whole tokens only').min(1, 'Grant at least 1 token').max(10000, 'Max 10,000 per grant'),
  reason: z.string().min(4, 'Add a short reason for the audit log')
});

export type TokenGrantValues = z.infer<typeof schema>;

interface TokenGrantFormProps {
  userName: string;
  currentTokens: number;
  onSubmit: (values: TokenGrantValues) => void;
  onCancel: () => void;
}

export function TokenGrantForm({ userName, currentTokens, onSubmit, onCancel }: TokenGrantFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<TokenGrantValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: 100, reason: '' }
  });

  const amount = Number(watch('amount')) || 0;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <p className="text-sm text-slate-500">
        Granting tokens to <span className="font-semibold text-slate-900 dark:text-slate-100">{userName}</span>. Current
        balance <span className="font-mono">{currentTokens.toLocaleString()}</span>.
      </p>
      <Input label="Tokens to grant" type="number" mono error={errors.amount?.message} {...register('amount')} />
      <Textarea
        label="Reason"
        placeholder="Goodwill credit for failed publish"
        error={errors.reason?.message}
        {...register('reason')} />
      
      <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
        <p className="text-xs text-slate-500">New balance</p>
        <p className="font-mono text-lg font-bold text-slate-900 dark:text-slate-50">
          {(currentTokens + amount).toLocaleString()}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Grant tokens
        </Button>
      </div>
    </form>);

}