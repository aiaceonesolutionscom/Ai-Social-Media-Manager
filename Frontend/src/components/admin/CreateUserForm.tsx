import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters').optional().or(z.literal('')),
  packageId: z.string().optional(),
  tokens: z.coerce.number().int().min(0, 'Cannot be negative').optional(),
});

export type CreateUserFormValues = z.infer<typeof schema>;

interface CreateUserFormProps {
  packages: Array<{ id: string; name: string; tokens: number }>;
  onSubmit: (values: CreateUserFormValues) => void;
  onCancel: () => void;
}

export function CreateUserForm({ packages, onSubmit, onCancel }: CreateUserFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<CreateUserFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      packageId: '',
      tokens: 0,
    }
  });

  const selectedPackage = watch('packageId');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <Input label="Full name" placeholder="John Doe" error={errors.name?.message} {...register('name')} />
      <Input label="Email" type="email" placeholder="john@example.com" error={errors.email?.message} {...register('email')} />
      <Input label="Password" type="password" placeholder="At least 6 characters (optional)" error={errors.password?.message} {...register('password')} />
      
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="package" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Package
          </label>
          <select
            id="package"
            {...register('packageId')}
            className="w-full h-11 rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700"
          >
            <option value="">No package</option>
            {packages.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>{pkg.name} ({pkg.tokens} tokens)</option>
            ))}
          </select>
        </div>
        <Input label="Additional tokens" type="number" mono error={errors.tokens?.message} {...register('tokens')} />
      </div>

      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Create user
        </Button>
      </div>
    </form>
  );
}
