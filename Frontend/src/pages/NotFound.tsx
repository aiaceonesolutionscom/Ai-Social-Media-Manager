
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Logo } from '../components/ui/Logo';
import { PageTransition } from '../components/layout/PageTransition';

export function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="flex min-h-full w-full items-center justify-center bg-slate-50 px-4 py-20 dark:bg-slate-950">
      <PageTransition className="text-center">
        <Logo className="justify-center" />
        <p className="mt-8 font-mono text-sm uppercase tracking-widest text-indigo-600 dark:text-indigo-300">404</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Page not found</h1>
        <p className="mt-3 max-w-md text-slate-500">
          The page you're looking for doesn't exist or has moved. Let's get you back to something useful.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Go back
          </Button>
          <Button onClick={() => navigate('/')}>Back to home</Button>
        </div>
      </PageTransition>
    </main>);

}