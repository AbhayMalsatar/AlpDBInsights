import * as React from 'react'
import { cn } from '@/utils/cn'

type Variant = 'default' | 'ghost' | 'outline' | 'destructive' | 'secondary' | 'subtle'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variantStyles: Record<Variant, string> = {
  default:     'btn-primary-glow text-white font-medium',
  ghost:       'hover:bg-accent/60 text-current',
  outline:     'border border-border bg-transparent hover:bg-accent/60 text-foreground hover:border-primary/30',
  destructive: 'bg-red-600 text-white hover:bg-red-500 shadow-sm',
  secondary:   'bg-secondary text-secondary-foreground hover:bg-secondary/70',
  subtle:      'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
}

const sizeStyles: Record<Size, string> = {
  sm:      'h-8 px-3 text-xs rounded-lg gap-1.5',
  md:      'h-9 px-4 text-sm rounded-xl gap-2',
  lg:      'h-11 px-6 text-sm rounded-xl gap-2 font-semibold',
  icon:    'h-9 w-9 rounded-xl p-0',
  'icon-sm': 'h-7 w-7 rounded-lg p-0',
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', loading, disabled, children, style, ...props }, ref) => {
    const isPrimary = variant === 'default'

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:pointer-events-none disabled:opacity-40',
          'cursor-pointer select-none',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        style={isPrimary ? {
          background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(271 65% 55%))',
          ...style,
        } : style}
        disabled={disabled ?? loading}
        {...props}
      >
        {loading ? (
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : children}
      </button>
    )
  }
)
Button.displayName = 'Button'
