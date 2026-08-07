import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MenuIcon, XIcon } from 'lucide-react';
import { Logo } from './Logo';
import { Button } from './Button';
import { useUserAuth } from '../../contexts/UserAuthContext';

const links = [
{ label: 'Features', href: '#features' },
{ label: 'How it works', href: '#how-it-works' },
{ label: 'Pricing', href: '#pricing' }];


export function Navbar() {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useUserAuth();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/85 backdrop-blur dark:bg-slate-900/85 dark:border-slate-800">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5" aria-label="Main">
        <Logo />
        <ul className="hidden md:flex items-center gap-8">
          {links.map((link) =>
          <li key={link.href}>
              <a
              href={link.href}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-colors">
              
                {link.label}
              </a>
            </li>
          )}
        </ul>
        <div className="hidden md:flex items-center gap-3">
          {isAuthenticated ? (
            <>
              <span className="text-sm text-slate-600 dark:text-slate-300">{user?.name || user?.email}</span>
              <Button variant="secondary" size="sm" onClick={() => navigate('/dashboard')}>
                Dashboard
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { logout(); navigate('/'); }}>
                Log out
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => navigate('/login')}>
                Log in
              </Button>
              <Button size="sm" onClick={() => navigate('/signup')}>
                Get started
              </Button>
            </>
          )}
        </div>
        <button
          type="button"
          className="md:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}>
          
          {open ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
        </button>
      </nav>
      {open &&
      <div className="md:hidden border-t border-slate-200 dark:border-slate-800 px-4 py-4 space-y-3 animate-fade-in">
          {links.map((link) =>
        <a
          key={link.href}
          href={link.href}
          onClick={() => setOpen(false)}
          className="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
          
              {link.label}
            </a>
        )}
          <div className="grid gap-3 pt-2">
            {isAuthenticated ? (
              <>
                <span className="text-center text-sm text-slate-600 dark:text-slate-300">{user?.name || user?.email}</span>
                <Link to="/dashboard" onClick={() => setOpen(false)}>
                  <Button variant="secondary" fullWidth>Dashboard</Button>
                </Link>
                <Button variant="ghost" fullWidth onClick={() => { logout(); navigate('/'); setOpen(false); }}>
                  Log out
                </Button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setOpen(false)}>
                  <Button variant="secondary" fullWidth>
                    Log in
                  </Button>
                </Link>
                <Link to="/signup" onClick={() => setOpen(false)}>
                  <Button fullWidth>Get started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      }
    </header>);

}