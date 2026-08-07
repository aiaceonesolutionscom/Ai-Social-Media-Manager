import React from 'react';
import { motion } from 'framer-motion';
import { CheckIcon, XIcon } from 'lucide-react';
import type { PricingPackage } from '../../types';
import { Button } from '../ui/Button';
import { cn } from '../../utils/cn';

interface PricingCardProps {
  pkg: PricingPackage;
  onSelect: (pkg: PricingPackage) => void;
  ctaLabel?: string;
  index?: number;
  selected?: boolean;
}

export function PricingCard({ pkg, onSelect, ctaLabel = 'Choose Plan', index = 0, selected = false }: PricingCardProps) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className={cn(
        'relative flex flex-col bg-white dark:bg-slate-900 rounded-2xl border shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 p-6',
        pkg.popular || selected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 dark:border-slate-800'
      )}>
      
      {pkg.popular &&
      <span className="absolute -top-3 left-6 rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white shadow-sm">
          Most Popular
        </span>
      }
      <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">{pkg.name}</h3>
      <p className="mt-1 text-sm text-slate-500">{pkg.description}</p>
      <p className="mt-5 flex items-baseline gap-1">
        <span className="font-mono text-4xl font-bold text-slate-900 dark:text-slate-50">${pkg.price}</span>
        <span className="text-sm text-slate-500">/month</span>
      </p>
      <p className="mt-2 font-mono text-sm font-semibold text-indigo-600 dark:text-indigo-300">
        {pkg.tokens.toLocaleString()} tokens included
      </p>
      <ul className="mt-6 flex-1 space-y-3">
        {pkg.features.map((feature) =>
        <li key={feature.label} className="flex items-start gap-2.5 text-sm">
            {feature.included ?
          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" /> :

          <XIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />
          }
            <span className={feature.included ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 line-through'}>
              {feature.label}
            </span>
            <span className="sr-only">{feature.included ? 'included' : 'not included'}</span>
          </li>
        )}
      </ul>
      <Button
        className="mt-6"
        fullWidth
        variant={pkg.popular ? 'primary' : 'secondary'}
        onClick={() => onSelect(pkg)}
        aria-label={`${ctaLabel}: ${pkg.name}`}>
        
        {ctaLabel}
      </Button>
    </motion.li>);

}