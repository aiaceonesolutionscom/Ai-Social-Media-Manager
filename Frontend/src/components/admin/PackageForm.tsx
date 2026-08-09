import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { PricingPackage } from '../../types';
import { Input, Textarea } from '../ui/Input';
import { Button } from '../ui/Button';
import { cn } from '../../utils/cn';
import { FEATURE_OPTIONS } from '../../utils/features';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().min(5, 'Add a short description'),
  price: z.coerce.number().min(0, 'Price cannot be negative'),
  tokens: z.coerce.number().int('Tokens must be a whole number').min(0, 'At least 0 tokens'),
  sortOrder: z.coerce.number().int().min(0, 'Sort order cannot be negative'),
  billingPeriod: z.enum(['monthly', 'yearly']),
  yearlyPrice: z.coerce.number().min(0).default(0),
  setupType: z.enum(['none', 'standard', 'premium']),
  features: z.array(z.string()).min(1, 'Select at least one feature')
});

export type PackageFormValues = z.infer<typeof schema>;

interface PackageFormProps {
  initial?: PricingPackage | null;
  onSubmit: (values: PackageFormValues) => void;
  onCancel: () => void;
}

const selectClass =
  'w-full h-11 rounded-xl border bg-white px-3.5 text-sm text-slate-900 border-slate-200 transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700';

export function PackageForm({ initial, onSubmit, onCancel }: PackageFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<PackageFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      price: initial?.price ?? 0,
      tokens: initial?.tokens ?? 100,
      sortOrder: initial?.sortOrder ?? 0,
      billingPeriod: initial?.billingPeriod ?? 'monthly',
      yearlyPrice: initial?.yearlyPrice ?? 0,
      setupType: initial?.setupType ?? 'none',
      features: initial?.features.filter((f) => f.included).map((f) => f.label) ?? []
    }
  });

  const selected = watch('features');
  const billingPeriod = watch('billingPeriod');

  const toggleFeature = (label: string) => {
    setValue('features', selected.includes(label) ? selected.filter((f) => f !== label) : [...selected, label], {
      shouldValidate: true
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <Input label="Package name" placeholder="Pro" error={errors.name?.message} {...register('name')} />
      <Textarea
        label="Description"
        placeholder="For teams publishing every day."
        error={errors.description?.message}
        {...register('description')} />

      <div className="grid gap-5 sm:grid-cols-3">
        <Input label="Price (USD)" type="number" step="1" mono error={errors.price?.message} {...register('price')} />
        <Input label="Tokens" type="number" step="1" mono error={errors.tokens?.message} {...register('tokens')} />
        <Input label="Sort order" type="number" step="1" mono error={errors.sortOrder?.message} {...register('sortOrder')} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="billing-period">
            Billing period
          </label>
          <select id="billing-period" className={selectClass} {...register('billingPeriod')}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="setup-type">
            Setup type
          </label>
          <select id="setup-type" className={selectClass} {...register('setupType')}>
            <option value="none">None — regular plan</option>
            <option value="standard">Standard setup</option>
            <option value="premium">Premium setup</option>
          </select>
          <p className="mt-1.5 text-xs text-slate-500">Setup packages are one-time fees shown in their own section.</p>
        </div>
      </div>

      {billingPeriod === 'yearly' && (
        <Input
          label="Yearly price (USD)"
          type="number"
          step="1"
          mono
          hint="Total billed once for 12 months."
          error={errors.yearlyPrice?.message}
          {...register('yearlyPrice')} />
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Included features</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {FEATURE_OPTIONS.map((feature) =>
          <label
            key={feature}
            className={cn(
              'flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
              selected.includes(feature) && 'border-indigo-300 bg-indigo-50/50 dark:border-indigo-700 dark:bg-indigo-950/40'
            )}>

              <input
              type="checkbox"
              checked={selected.includes(feature)}
              onChange={() => toggleFeature(feature)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />

              {feature}
            </label>
          )}
        </div>
        {errors.features &&
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
            {errors.features.message}
          </p>
        }
      </fieldset>
      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {initial ? 'Save changes' : 'Create package'}
        </Button>
      </div>
    </form>);

}
