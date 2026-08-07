import React from 'react';
import { motion } from 'framer-motion';

export function PageTransition({ children, className }: {children: React.ReactNode;className?: string;}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={className}>
      
      {children}
    </motion.div>);

}