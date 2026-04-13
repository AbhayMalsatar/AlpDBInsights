import * as React from 'react'
import { cn } from '@/utils/cn'

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  secondary: 'bg-secondary text-secondary-foreground border-transparent',
  success: 'bg-green-600/20 text-green-400 border-green-600/30',
  warning: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  destructive: 'bg-red-600/20 text-red-400 border-red-600/30',
  outline: 'border border-border text-foreground bg-transparent',
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
