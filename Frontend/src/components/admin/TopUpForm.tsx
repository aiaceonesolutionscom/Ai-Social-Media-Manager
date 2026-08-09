import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { TopUpBundle } from '../../types';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

const schema = z.object({
  tokens: z.coerce.number().int('Tokens must be a whole number').min(1, 'At least 1 token'),
  price: z.coerce.number().min(0, 'Price cannot be negative'),
  sortOrder: z.coerce.number().int().min(0, 'Sort order cannot be negative'),
});

export type TopUpFormValues = z.infer<typeof schema>;

interface TopUpFormProps {
  initial?: TopUpBundle | null;
  onSubmit: (values: TopUpFormValues) => void;
  onCancel: () => void;
}

export function TopUpForm({ initial, onSubmit, onCancel }: TopUpFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<TopUpFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      tokens: initial?.tokens ?? 500,
      price: initial?.price ?? 10,
      sortOrder: initial?.sortOrder ?? 0,
    }
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-3">
        <Input label="Tokens" type="number" step="1" mono error={errors.tokens?.message} {...register('tokens')} />
        <Input label="Price (USD)" type="number" step="1" mono error={errors.price?.message} {...register('price')} />
        <Input label="Sort order" type="number" step="1" mono error={errors.sortOrder?.message} {...register('sortOrder')} />
      </div>
      <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
        Customers buy this bundle from the Packages page to add extra credits. Buying it never changes their plan.
      </p>
      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {initial ? 'Save changes' : 'Create bundle'}
        </Button>
      </div>
    </form>
  );
}
