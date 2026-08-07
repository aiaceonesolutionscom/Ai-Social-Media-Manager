import React from 'react';
import { Link } from 'react-router-dom';
import { GithubIcon, InstagramIcon, LinkedinIcon, TwitterIcon } from 'lucide-react';
import { Logo } from './Logo';

const groups = [
{
  title: 'Product',
  links: [
  { label: 'Pricing', to: '/packages' },
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Connect accounts', to: '/connect' }]

},
{
  title: 'Company',
  links: [
  { label: 'Sign up', to: '/signup' },
  { label: 'Log in', to: '/login' },
  { label: 'Admin', to: '/admin/login' }]

},
{
  title: 'Legal',
  links: [
  { label: 'Terms of service', to: '/signup' },
  { label: 'Privacy policy', to: '/signup' },
  { label: 'Data processing', to: '/signup' }]

}];


const socials = [
{ label: 'Twitter', icon: TwitterIcon, href: 'https://twitter.com' },
{ label: 'Instagram', icon: InstagramIcon, href: 'https://instagram.com' },
{ label: 'LinkedIn', icon: LinkedinIcon, href: 'https://linkedin.com' },
{ label: 'GitHub', icon: GithubIcon, href: 'https://github.com' }];


export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-slate-500">
              Speak once. EchoPost turns your voice notes into publish-ready posts across every channel.
            </p>
            <ul className="mt-5 flex items-center gap-3">
              {socials.map((s) =>
              <li key={s.label}>
                  <a
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={s.label}
                  className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 dark:border-slate-700 dark:hover:bg-slate-800">
                  
                    <s.icon className="h-4 w-4" aria-hidden="true" />
                  </a>
                </li>
              )}
            </ul>
          </div>
          {groups.map((group) =>
          <nav key={group.title} aria-label={group.title}>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">{group.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) =>
              <li key={link.label}>
                    <Link
                  to={link.to}
                  className="text-sm text-slate-500 transition-colors hover:text-indigo-600 dark:hover:text-indigo-300">
                  
                      {link.label}
                    </Link>
                  </li>
              )}
              </ul>
            </nav>
          )}
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} EchoPost Inc. All rights reserved.</p>
          <p className="font-mono text-xs text-slate-400">status: all systems operational</p>
        </div>
      </div>
    </footer>);

}