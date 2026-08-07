import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { notify } from '../../components/ui/Toast';
import { useAuth } from '../../contexts/AuthContext';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

type AdminLoginValues = z.infer<typeof schema>;

export function AdminLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<AdminLoginValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const onSubmit = async (data: AdminLoginValues) => {
    const result = await login(data.email, data.password);
    if (result.success) {
      notify.success('Welcome back', 'Signed in to the admin panel.');
      navigate('/admin/dashboard');
    } else {
      notify.error('Login failed', result.error || 'Invalid credentials');
    }
  };

  return (
    <AuthLayout
      title="Admin Login"
      subtitle="Restricted access. Staff credentials only."
      logoLabel="Admin Panel"
      showBack={false}
      footer={
      <button
        type="button"
        onClick={() => navigate('/')}
        className="font-medium text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-slate-200">
        
          ← Back to the marketing site
        </button>
      }>
      
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="ops@echopost.app"
          error={errors.email?.message}
          {...register('email')} />
        
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          error={errors.password?.message}
          {...register('password')} />
        
        <Button type="submit" fullWidth loading={isSubmitting}>
          Login
        </Button>
      </form>
    </AuthLayout>
  );
}
