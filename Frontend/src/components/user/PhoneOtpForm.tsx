import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheckIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { notify } from '../ui/Toast';
import { delay } from '../../utils/api';
import { cn } from '../../utils/cn';

const countryCodes = [
{ code: '+1', label: 'US +1' },
{ code: '+44', label: 'UK +44' },
{ code: '+91', label: 'IN +91' },
{ code: '+61', label: 'AU +61' },
{ code: '+27', label: 'ZA +27' },
{ code: '+234', label: 'NG +234' }];


const phoneSchema = z.object({
  countryCode: z.string().min(2),
  phone: z.
  string().
  min(6, 'Enter a valid phone number').
  max(14, 'Enter a valid phone number').
  regex(/^[0-9\s]+$/, 'Digits only')
});

type PhoneValues = z.infer<typeof phoneSchema>;

interface PhoneOtpFormProps {
  submitLabel: string;
  onVerified: () => void;
}

export function PhoneOtpForm({ submitLabel, onVerified }: PhoneOtpFormProps) {
  const [stage, setStage] = React.useState<'phone' | 'otp'>('phone');
  const [otp, setOtp] = React.useState<string[]>(Array(6).fill(''));
  const [otpError, setOtpError] = React.useState<string | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const inputsRef = React.useRef<Array<HTMLInputElement | null>>([]);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting }
  } = useForm<PhoneValues>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { countryCode: '+1', phone: '' }
  });

  const sendOtp = async () => {
    await delay(800);
    setStage('otp');
    notify.success('Verification code sent', `We texted a 6-digit code to ${getValues('countryCode')} ${getValues('phone')}.`);
    window.setTimeout(() => inputsRef.current[0]?.focus(), 80);
  };

  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    setOtpError(null);
    if (digit && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) inputsRef.current[index - 1]?.focus();
    if (e.key === 'ArrowLeft' && index > 0) inputsRef.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(6).fill('');
    pasted.split('').forEach((d, i) => {
      next[i] = d;
    });
    setOtp(next);
    inputsRef.current[Math.min(pasted.length, 5)]?.focus();
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.some((d) => d === '')) {
      setOtpError('Enter all 6 digits');
      return;
    }
    setVerifying(true);
    await delay(900);
    setVerifying(false);
    notify.success('Phone verified', 'Welcome to EchoPost.');
    onVerified();
  };

  if (stage === 'otp') {
    return (
      <form onSubmit={verify} className="space-y-6" noValidate>
        <div>
          <label htmlFor="otp-0" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Enter the 6-digit code
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Sent to {getValues('countryCode')} {getValues('phone')}
          </p>
          <div className="mt-3 grid grid-cols-6 gap-2" onPaste={handlePaste}>
            {otp.map((digit, index) =>
            <input
              key={index}
              id={`otp-${index}`}
              ref={(el) => {
                inputsRef.current[index] = el;
              }}
              value={digit}
              onChange={(e) => handleOtpChange(index, e.target.value)}
              onKeyDown={(e) => handleOtpKeyDown(index, e)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              aria-label={`Digit ${index + 1}`}
              aria-invalid={otpError ? true : undefined}
              className={cn(
                'h-12 w-full rounded-xl border bg-white text-center font-mono text-lg font-bold text-slate-900 transition-colors',
                'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:bg-slate-900 dark:text-slate-100',
                otpError ? 'border-red-400' : 'border-slate-200 dark:border-slate-700'
              )} />

            )}
          </div>
          {otpError &&
          <p role="alert" className="mt-2 text-xs font-medium text-red-600">
              {otpError}
            </p>
          }
        </div>
        <Button type="submit" fullWidth loading={verifying}>
          Verify &amp; Continue
        </Button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => setStage('phone')}
            className="font-medium text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-slate-200">
            
            Change number
          </button>
          <button
            type="button"
            onClick={() => notify.info('Code resent', 'Check your messages again in a few seconds.')}
            className="font-medium text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-300">
            
            Resend code
          </button>
        </div>
      </form>);

  }

  return (
    <form onSubmit={handleSubmit(sendOtp)} className="space-y-6" noValidate>
      <div>
        <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Phone number
        </label>
        <div className="flex gap-2">
          <select
            aria-label="Country code"
            className="h-11 w-28 shrink-0 rounded-xl border border-slate-200 bg-white px-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            {...register('countryCode')}>
            
            {countryCodes.map((c) =>
            <option key={c.code} value={c.code}>
                {c.label}
              </option>
            )}
          </select>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            placeholder="415 555 0142"
            aria-invalid={errors.phone ? true : undefined}
            className={cn(
              'h-11 w-full rounded-xl border bg-white px-3.5 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400',
              'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:bg-slate-900 dark:text-slate-100',
              errors.phone ? 'border-red-400' : 'border-slate-200 dark:border-slate-700'
            )}
            {...register('phone')} />
          
        </div>
        {errors.phone &&
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
            {errors.phone.message}
          </p>
        }
      </div>
      <Button type="submit" fullWidth loading={isSubmitting}>
        {submitLabel}
      </Button>
      <p className="flex items-start gap-2 text-xs text-slate-500">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
        We only use your number to verify your account. No spam, ever.
      </p>
    </form>);

}